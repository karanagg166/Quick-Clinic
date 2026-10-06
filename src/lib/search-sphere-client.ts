import "server-only";
import { createHash, randomUUID } from "crypto";
import { getCurrentRequestId } from "@/lib/correlation-id";
import type {
  StorageUploadResult,
  StorageSignedUrlResult,
  StorageDeleteResult,
  IngestionQueueResult,
  ProcessingStatusResult,
  IngestionQueueParams,
  MedicalRetrievalResponse,
  MedicalRetrievalSearchParams,
  MedicalRagCitation,
  MedicalRagAnswerResult,
  MedicalRagAnswerParams,
  MedicalChatParams,
  MedicalChatResult,
  PatientMedicalObservationsResponse,
  QueryPatientMedicalObservationsParams,
  ClientRequestOptions,
} from "@/types/search-sphere";

export * from "@/types/search-sphere";

function getServiceConfig() {
  const secret = process.env.SEARCH_SPHERE_API_KEY || process.env.SEARCH_SPHERE_SERVICE_SECRET;
  if (!secret) {
    throw new Error("SEARCH_SPHERE_API_KEY or SEARCH_SPHERE_SERVICE_SECRET is not configured");
  }

  const rawUrl = process.env.SEARCH_SPHERE_API_URL;
  if (!rawUrl) {
    throw new Error("SEARCH_SPHERE_API_URL is not configured");
  }

  const baseUrl = rawUrl.replace(/\/$/, "");
  const clientId = process.env.SEARCH_SPHERE_CLIENT_ID || "quick_clinic";
  const tenantId = process.env.SEARCH_SPHERE_TENANT_ID || "quick_clinic_default";
  if (clientId !== "quick_clinic") throw new Error("Invalid Search Sphere client configuration");
  return { baseUrl, secret, clientId, tenantId };
}

export function patientCollectionId(patientId: string): string {
  return `patient_${createHash("sha256").update(patientId).digest("hex").slice(0, 32)}_records`;
}

function subjectFromRequest(url: string, init: RequestInit): string | undefined {
  if (init.body instanceof FormData) {
    const patient = init.body.get("patient_id");
    return typeof patient === "string" ? patient : undefined;
  }
  if (typeof init.body === "string") {
    const body = JSON.parse(init.body) as { patientId?: string; storagePath?: string };
    if (body.patientId) return body.patientId;
    if (body.storagePath) return body.storagePath.split("/")[1];
  }
  const storagePath = new URL(url).searchParams.get("storagePath");
  return storagePath?.split("/")[1];
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function isRetryableError(error: any): boolean {
  if (!error) return false;
  const msg = (error.message || "").toLowerCase();
  return (
    error.name === "AbortError" ||
    error.name === "TimeoutError" ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("network") ||
    msg.includes("timeout")
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class SearchSphereServiceError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function sanitizeCitations(
  citations?: MedicalRagCitation[] | null
): MedicalRagCitation[] {
  if (!citations || !Array.isArray(citations)) return [];
  return citations.map((citation) => {
    // Strip internal reranker/vector scores from client citations
    const { score: _, ...rest } = citation;
    void _;
    return rest;
  });
}

/**
 * Core HTTP fetch wrapper with:
 * 1. Automatic X-Request-ID propagation
 * 2. Fail-closed internal service bearer authentication
 * 3. Bounded request timeout
 * 4. Bounded exponential backoff retry for retryable failures
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options?: ClientRequestOptions
): Promise<Response> {
  const timeoutMs = options?.timeoutMs ?? 15000;
  const maxRetries = options?.retries ?? 2;
  const requestId = options?.requestId || getCurrentRequestId() || randomUUID();

  const rawHeaders: Record<string, string> = {};
  if (init.headers) {
    if (typeof (init.headers as any).forEach === "function") {
      (init.headers as Headers).forEach((val, key) => {
        rawHeaders[key] = val;
      });
    } else if (Array.isArray(init.headers)) {
      for (const [k, v] of init.headers) {
        rawHeaders[k] = v;
      }
    } else {
      Object.assign(rawHeaders, init.headers);
    }
  }
  const config = getServiceConfig();
  rawHeaders["Authorization"] = `Bearer ${config.secret}`;
  rawHeaders["X-Client-ID"] = config.clientId;
  rawHeaders["X-Tenant-ID"] = config.tenantId;
  const subjectId = options?.subjectId || subjectFromRequest(url, init);
  if (subjectId) {
    rawHeaders["X-Subject-ID"] = subjectId;
    rawHeaders["X-Collection-ID"] = patientCollectionId(subjectId);
  }
  rawHeaders["X-Request-ID"] = requestId;

  let lastError: any = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("Request timeout")), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        headers: rawHeaders,
        signal: controller.signal,
      });

      clearTimeout(timer);

      // Fast-fail non-retryable errors immediately
      if (!response.ok && !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }

      // If retryable and attempts remain, back off and retry
      if (!response.ok && RETRYABLE_STATUSES.has(response.status) && attempt < maxRetries) {
        await delay((attempt + 1) * 200);
        continue;
      }

      return response;
    } catch (err: any) {
      clearTimeout(timer);
      lastError = err;

      if (isRetryableError(err) && attempt < maxRetries) {
        await delay((attempt + 1) * 200);
        continue;
      }

      throw new Error("Search-Sphere is temporarily unavailable.");
    }
  }

  throw lastError || new Error("Request failed after retries");
}

/**
 * Uploads medical document file bytes to Search Sphere internal storage API.
 */
export async function uploadToStorage(
  params: {
    file: Blob;
    fileName: string;
    patientId: string;
    documentId: string;
  },
  options?: ClientRequestOptions
): Promise<StorageUploadResult> {
  const { baseUrl, secret } = getServiceConfig();
  const form = new FormData();

  form.append("file", params.file, params.fileName);
  form.append("patient_id", params.patientId);
  form.append("document_id", params.documentId);

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-documents`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
      body: form,
    },
    { ...options, retries: 0 } // Do not auto-retry multipart streaming upload
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to store document in object storage";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Storage upload failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    storagePath: data.storagePath,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
  };
}

/**
 * Requests a short-lived signed URL for reading/downloading a medical document.
 */
export async function getSignedStorageUrl(
  storagePath: string,
  expiresIn: number = 600,
  options?: ClientRequestOptions
): Promise<StorageSignedUrlResult> {
  const { baseUrl, secret } = getServiceConfig();

  const url = new URL(`${baseUrl}/internal/medical-documents/signed-url`);
  url.searchParams.set("storagePath", storagePath);
  url.searchParams.set("expiresIn", expiresIn.toString());

  const response = await fetchWithRetry(
    url.toString(),
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    },
    options
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to generate signed document URL";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Storage access URL failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    url: data.url,
    expiresIn: data.expiresIn,
  };
}

/**
 * Deletes a medical document object from private storage.
 */
export async function deleteFromStorage(
  storagePath: string,
  options?: ClientRequestOptions
): Promise<StorageDeleteResult> {
  const { baseUrl, secret } = getServiceConfig();

  const url = new URL(`${baseUrl}/internal/medical-documents`);
  url.searchParams.set("storagePath", storagePath);

  const response = await fetchWithRetry(
    url.toString(),
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    },
    options
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to delete document from object storage";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Storage delete failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    success: data.success ?? true,
    message: data.message ?? "Medical document deleted successfully",
  };
}

/**
 * Enqueues a medical document for asynchronous vector extraction and indexing in Search Sphere.
 */
export async function queueMedicalDocumentIngestion(
  params: IngestionQueueParams,
  options?: ClientRequestOptions
): Promise<IngestionQueueResult> {
  const { baseUrl, secret } = getServiceConfig();

  const reportDateStr = params.reportDate
    ? typeof params.reportDate === "string"
      ? params.reportDate
      : params.reportDate.toISOString()
    : null;

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-documents/${encodeURIComponent(params.documentId)}/ingest`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        patientId: params.patientId,
        storagePath: params.storagePath,
        fileName: params.fileName,
        mimeType: params.mimeType,
        fileSize: params.fileSize,
        documentType: params.documentType,
        reportDate: reportDateStr,
      }),
    },
    { ...options, requestId: params.requestId || options?.requestId }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to enqueue medical document for ingestion";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Ingestion queue failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    documentId: data.documentId || params.documentId,
    status: data.status || "QUEUED",
  };
}

/**
 * Retrieves the asynchronous indexing status from Search Sphere.
 */
export async function getMedicalDocumentProcessingStatus(
  documentId: string,
  options?: ClientRequestOptions
): Promise<ProcessingStatusResult> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-documents/${encodeURIComponent(documentId)}/status`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    },
    options
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to fetch document processing status";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Status check failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    documentId: data.documentId || documentId,
    status: data.status,
    processedAt: data.processedAt ?? null,
    error: data.error ?? null,
  };
}

/**
 * Requests Search Sphere to delete vector embeddings, extracted text, and indexing record.
 */
export async function deleteMedicalDocumentIndex(
  documentId: string,
  options?: ClientRequestOptions
): Promise<{ success: boolean; message: string }> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-documents/${encodeURIComponent(documentId)}/index`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    },
    options
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to delete medical document vector index";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new SearchSphereServiceError(response.status, `Vector index deletion failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    success: data.success ?? true,
    message: data.message ?? "Vector index deleted successfully",
  };
}

/**
 * Re-enqueues a medical document for indexing.
 */
export async function retryMedicalDocumentIngestion(
  params: IngestionQueueParams,
  options?: ClientRequestOptions
): Promise<IngestionQueueResult> {
  return queueMedicalDocumentIngestion(params, options);
}

/**
 * Executes a patient-scoped medical record search against Search Sphere internal retrieval API.
 */
export async function searchPatientMedicalRecords(
  params: MedicalRetrievalSearchParams,
  options?: ClientRequestOptions
): Promise<MedicalRetrievalResponse> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-retrieval/search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        patientId: params.patientId,
        query: params.query,
        limit: params.limit ?? 8,
        documentType: params.documentType,
        fromDate: params.fromDate,
        toDate: params.toDate,
      }),
    },
    { ...options, requestId: params.requestId || options?.requestId }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to search patient medical records";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Medical retrieval failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    results: (data.results || []).map((r: any) => {
      const { score: _, ...rest } = r;
      void _;
      return rest;
    }),
  };
}

/**
 * Calls Search Sphere internal medical RAG endpoint to generate a grounded answer.
 */
export async function generatePatientMedicalAnswer(
  params: MedicalRagAnswerParams,
  options?: ClientRequestOptions
): Promise<MedicalRagAnswerResult> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-rag/answer`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        patientId: params.patientId,
        query: params.query,
        limit: params.limit ?? 8,
        documentType: params.documentType,
        fromDate: params.fromDate,
        toDate: params.toDate,
      }),
    },
    { ...options, requestId: params.requestId || options?.requestId }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to generate grounded medical answer";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Medical RAG generation failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const rawCitations = data.citations || [];
  return {
    answer: data.answer || "",
    citations: sanitizeCitations(rawCitations),
    resultCount: data.resultCount ?? rawCitations.length,
  };
}

/**
 * Calls Search Sphere internal medical chat endpoint to generate a multi-turn grounded answer.
 */
export async function generatePatientMedicalChat(
  params: MedicalChatParams,
  options?: ClientRequestOptions
): Promise<MedicalChatResult> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-rag/chat`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        patientId: params.patientId,
        message: params.message,
        history: params.history || [],
        limit: params.limit ?? 8,
        documentType: params.documentType,
        fromDate: params.fromDate,
        toDate: params.toDate,
      }),
    },
    { ...options, requestId: params.requestId || options?.requestId }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to generate medical chat answer";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Medical chat generation failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  const rawCitations = data.citations || [];
  return {
    answer: data.answer || "",
    citations: sanitizeCitations(rawCitations),
    resultCount: data.resultCount ?? rawCitations.length,
    retrievalQuery: data.retrievalQuery ?? null,
    rewritten: data.rewritten ?? false,
    answerMode: data.answerMode,
  };
}

/**
 * Initiates a streaming connection with Search Sphere internal medical chat endpoint.
 * Configured with 30s timeout and passes through X-Request-ID.
 */
export async function openPatientMedicalChatStream(
  params: MedicalChatParams,
  options?: ClientRequestOptions
): Promise<Response> {
  const { baseUrl, secret } = getServiceConfig();
  const requestId = params.requestId || options?.requestId || getCurrentRequestId() || randomUUID();

  const headers = new Headers();
  const config = getServiceConfig();
  headers.set("Authorization", `Bearer ${secret}`);
  headers.set("X-Client-ID", config.clientId);
  headers.set("X-Tenant-ID", config.tenantId);
  headers.set("X-Subject-ID", params.patientId);
  headers.set("X-Collection-ID", patientCollectionId(params.patientId));
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  headers.set("X-Request-ID", requestId);

  const controller = new AbortController();
  const timeoutMs = options?.timeoutMs ?? 30000;
  const timer = setTimeout(() => controller.abort(new Error("Stream timeout")), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/internal/medical-rag/chat/stream`, {
      method: "POST",
      headers,
      signal: options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      body: JSON.stringify({
        patientId: params.patientId,
        message: params.message,
        history: params.history || [],
        limit: params.limit ?? 8,
        documentType: params.documentType,
        fromDate: params.fromDate,
        toDate: params.toDate,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let detail = "Failed to initiate medical chat stream";
      try {
        const parsed = JSON.parse(errorText);
        void parsed; // Upstream details may contain infrastructure or credentials.
      } catch {
        // ignore
      }
      throw new Error(`Medical chat streaming failed (${response.status}): ${detail}`);
    }

    if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("Invalid medical chat stream response");
    }
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(streamController) {
        try {
          const next = await reader.read();
          if (next.done) {
            clearTimeout(timer);
            streamController.close();
          } else {
            streamController.enqueue(next.value);
          }
        } catch (error) {
          clearTimeout(timer);
          streamController.error(error);
        }
      },
      async cancel(reason) {
        clearTimeout(timer);
        controller.abort();
        await reader.cancel(reason);
      },
    });
    return new Response(body, { status: response.status, headers: response.headers });
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * Queries patient structured medical observations from Search Sphere.
 */
export async function queryPatientMedicalObservations(
  params: QueryPatientMedicalObservationsParams,
  options?: ClientRequestOptions
): Promise<PatientMedicalObservationsResponse> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-observations/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        patientId: params.patientId,
        observationTypes: params.observationTypes,
        fromDate: params.fromDate,
        toDate: params.toDate,
        limit: params.limit ?? 100,
        sort: params.sort ?? "asc",
      }),
    },
    { ...options, requestId: params.requestId || options?.requestId }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to query patient medical observations";
    try {
      const parsed = JSON.parse(errorText);
      void parsed; // Upstream details may contain infrastructure or credentials.
    } catch {
      // ignore
    }
    throw new Error(`Medical observations query failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    observations: data.observations || [],
    totalCount: data.totalCount ?? (data.observations ? data.observations.length : 0),
  };
}
