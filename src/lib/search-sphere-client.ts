import "server-only";
import { createHash, randomUUID } from "crypto";
import { getCurrentRequestId } from "@/lib/correlation-id";
import type {
  StorageUploadResult,
  StorageSignedUrlResult,
  StorageDeleteResult,
  IngestionQueueResult,
  ProcessingStatusResult,
  DocumentCleanupReceipt,
  IngestionQueueParams,
  MedicalRetrievalResponse,
  MedicalRetrievalSearchParams,
  MedicalRagCitation,
  MedicalRagAnswerResult,
  MedicalRagAnswerParams,
  MedicalChatParams,
  MedicalChatResult,
  MedicalConversationDeleteParams,
  PatientMedicalObservationsResponse,
  QueryPatientMedicalObservationsParams,
  ClientRequestOptions,
} from "@/types/search-sphere";

export * from "@/types/search-sphere";

export class SearchSphereConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchSphereConfigError";
  }
}

export class SearchSphereTimeoutError extends Error {
  public readonly status = 504;
  public readonly retryable = true;
  public readonly code = "GATEWAY_TIMEOUT";
  constructor(message = "Search-Sphere request timed out.") {
    super(message);
    this.name = "SearchSphereTimeoutError";
  }
}

export class SearchSphereUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number = 502,
    public readonly retryable: boolean = true,
    public readonly code: string = "STORAGE_UNAVAILABLE"
  ) {
    super(message);
    this.name = "SearchSphereUploadError";
  }
}

function getServiceConfig() {
  const secret = process.env.SEARCH_SPHERE_API_KEY || process.env.SEARCH_SPHERE_SERVICE_SECRET;
  if (!secret) {
    throw new SearchSphereConfigError("SEARCH_SPHERE_API_KEY or SEARCH_SPHERE_SERVICE_SECRET is not configured");
  }

  const rawUrl = process.env.SEARCH_SPHERE_API_URL;
  if (!rawUrl) {
    throw new SearchSphereConfigError("SEARCH_SPHERE_API_URL is not configured");
  }

  const baseUrl = rawUrl.replace(/\/$/, "");
  const clientId = process.env.SEARCH_SPHERE_CLIENT_ID || "quick_clinic";
  const tenantId = process.env.SEARCH_SPHERE_TENANT_ID || "quick_clinic_default";
  if (clientId !== "quick_clinic") throw new SearchSphereConfigError("Invalid Search Sphere client configuration");
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
  constructor(public readonly status: number, message: string, public readonly code = "upstream_unavailable") { super(message); }
}

const PROVIDER_ERROR_CODES = new Set(["provider_timeout", "provider_quota", "provider_rate_limit", "provider_not_approved", "provider_invalid_response", "provider_unavailable"]);

export function medicalChatFailure(error: unknown): { status: number; code: string } {
  if (error instanceof SearchSphereConfigError) return { status: 503, code: "upstream_unavailable" };
  if (error instanceof SearchSphereTimeoutError) return { status: 504, code: "provider_timeout" };
  if (error instanceof SearchSphereServiceError) return { status: [429, 503, 504].includes(error.status) ? error.status : 502, code: PROVIDER_ERROR_CODES.has(error.code) ? error.code : "upstream_unavailable" };
  return { status: 502, code: "upstream_unavailable" };
}

function medicalActor(params: Pick<MedicalChatParams, "actorId" | "conversationId">): string {
  const actor = params.actorId?.trim();
  if (!actor || actor.length > 255 || /[\r\n\0]/.test(actor)) throw new SearchSphereConfigError("Authenticated doctor identity is required.");
  if (params.conversationId !== undefined && (!params.conversationId.trim() || params.conversationId.length > 255)) throw new SearchSphereConfigError("Invalid conversation reference.");
  return actor;
}

/** Require committed, scoped upstream memory deletion before local thread removal. */
export async function deletePatientMedicalConversation(
  params: MedicalConversationDeleteParams,
  options?: ClientRequestOptions
): Promise<void> {
  const actor = medicalActor(params);
  if (!params.patientId.trim() || params.patientId.length > 255 || /[\r\n\0]/.test(params.patientId)) {
    throw new SearchSphereConfigError("Invalid patient scope.");
  }
  const { baseUrl } = getServiceConfig();
  const response = await fetchWithRetry(
    `${baseUrl}/internal/medical-rag/conversations/${encodeURIComponent(params.conversationId)}`,
    { method: "DELETE", redirect: "error", headers: { "X-Actor-ID": actor } },
    { ...options, subjectId: params.patientId, timeoutMs: Math.min(options?.timeoutMs ?? 10000, 10000), retries: 0 }
  );
  if (!response.ok || !response.body) {
    throw new SearchSphereServiceError(response.status, "Conversation cleanup is not verified.");
  }
  // Headers and receipt body each have a bounded deadline; never accept a partial
  // body or a purported success with a missing/false deletion assertion.
  const reader = response.body.getReader();
  let expired = false;
  const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => undefined); }, 2000);
  let bytes = 0;
  let body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    while (true) {
      const part = await reader.read();
      if (expired) throw new SearchSphereTimeoutError();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) throw new Error("Oversized deletion receipt.");
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    const receipt: unknown = JSON.parse(body);
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt) || !("deleted" in receipt) || receipt.deleted !== true) {
      throw new Error("Invalid deletion receipt.");
    }
  } catch {
    throw new SearchSphereServiceError(503, "Conversation cleanup is not verified.");
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

async function medicalProviderFailure(response: Response, message = "Medical AI chat is temporarily unavailable."): Promise<SearchSphereServiceError> {
  let code = "upstream_unavailable";
  try {
    const payload = await response.json();
    if (typeof payload?.error_code === "string" && PROVIDER_ERROR_CODES.has(payload.error_code)) code = payload.error_code;
  } catch { /* Only allowlisted codes leave the upstream boundary. */ }
  return new SearchSphereServiceError(response.status, message, code);
}

/** One budget covers transport and JSON/error-body parsing; model requests never replay. */
async function withMedicalQueryDeadline<T>(
  options: ClientRequestOptions | undefined,
  operation: (bounded: ClientRequestOptions) => Promise<T>,
  defaultTimeout = 15000,
): Promise<T> {
  const requested = options?.timeoutMs ?? defaultTimeout;
  if (!Number.isFinite(requested) || requested <= 0) throw new SearchSphereConfigError("Invalid medical query deadline.");
  const timeoutMs = Math.min(requested, 55000);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new SearchSphereTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      operation({
        ...options, retries: 0, timeoutMs,
        signal: options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      }),
      expired,
    ]);
  } finally {
    clearTimeout(timer);
  }
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
        signal: options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
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

      const isTimeout =
        err?.name === "AbortError" ||
        err?.name === "TimeoutError" ||
        (err?.message && String(err.message).toLowerCase().includes("timeout"));

      if (isRetryableError(err) && attempt < maxRetries) {
        await delay((attempt + 1) * 200);
        continue;
      }

      if (isTimeout) {
        throw new SearchSphereTimeoutError(
          `Search-Sphere request timed out after ${timeoutMs}ms.`
        );
      }

      throw err;
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

  // Default timeout of 45s accommodates Render free tier cold-starts while remaining within serverless limits
  const timeoutMs = options?.timeoutMs ?? 45000;

  let response: Response;
  try {
    response = await fetchWithRetry(
      `${baseUrl}/internal/medical-documents`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
        },
        body: form,
      },
      { timeoutMs, ...options, retries: 0 } // Do not auto-retry multipart streaming upload
    );
  } catch (err: any) {
    if (err instanceof SearchSphereConfigError) {
      throw err;
    }
    if (err instanceof SearchSphereTimeoutError) {
      throw new SearchSphereUploadError(
        "Storage upload request timed out.",
        504,
        true,
        "GATEWAY_TIMEOUT"
      );
    }
    const isTimeout =
      err?.name === "AbortError" ||
      err?.name === "TimeoutError" ||
      err?.code === "GATEWAY_TIMEOUT" ||
      err?.message?.toLowerCase().includes("timeout");
    throw new SearchSphereUploadError(
      isTimeout
        ? "Storage upload request timed out."
        : `Storage service is temporarily unavailable: ${err?.message || "Unknown error"}`,
      isTimeout ? 504 : 503,
      true,
      isTimeout ? "GATEWAY_TIMEOUT" : "STORAGE_UNAVAILABLE"
    );
  }

  if (!response.ok) {
    let detail = "Failed to store document in object storage";
    let retryable = false;
    let code = "STORAGE_ERROR";

    if (response.status === 400) {
      detail = "Invalid document payload rejected by storage service.";
      code = "VALIDATION_FAILED";
    } else if (response.status === 401 || response.status === 403) {
      detail = "Storage service authentication failure.";
      code = "STORAGE_AUTH_FAILURE";
    } else if (response.status === 413) {
      detail = "File exceeds upstream storage size limit.";
      code = "FILE_TOO_LARGE";
    } else if (response.status === 429) {
      detail = "Storage rate limit exceeded. Please retry shortly.";
      code = "RATE_LIMIT_EXCEEDED";
      retryable = true;
    } else if (response.status >= 500) {
      detail = "Upstream storage provider temporarily unavailable.";
      code = "STORAGE_UNAVAILABLE";
      retryable = true;
    }
    throw new SearchSphereUploadError(detail, response.status, retryable, code);
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
        forceReindex: params.forceReindex ?? false,
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
    status: data.status,
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
    currentVersionId: typeof data.currentVersionId === "string" ? data.currentVersionId : null,
    status: data.status,
    processedAt: data.processedAt ?? null,
    error: data.error ?? null,
  };
}

/** Read physical cleanup using a verified patient scope, including after local deletion. */
export async function getMedicalDocumentCleanupReceipt(
  documentId: string,
  options: ClientRequestOptions
): Promise<DocumentCleanupReceipt> {
  const patientId = options.subjectId?.trim();
  if (!patientId || /[\r\n\0]/.test(patientId) || patientId.length > 255) {
    throw new SearchSphereConfigError("Authorized patient scope is required for cleanup verification.");
  }
  if (!documentId.trim() || documentId.length > 255) {
    throw new SearchSphereConfigError("Invalid document identity.");
  }
  const { baseUrl } = getServiceConfig();
  const response = await fetchWithRetry(
    `${baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/cleanup`,
    { method: "GET", cache: "no-store" },
    { ...options, subjectId: patientId, retries: 0, timeoutMs: Math.min(options.timeoutMs ?? 10000, 10000) }
  );
  if (!response.ok) {
    throw new SearchSphereServiceError(response.status, "Document cleanup is not verified.");
  }
  let value: unknown;
  try { value = await response.json(); } catch {
    throw new SearchSphereServiceError(502, "Invalid document cleanup receipt.");
  }
  const receipt = value as Record<string, unknown> | null;
  if (!receipt || typeof receipt !== "object" || receipt.document_id !== documentId ||
      (receipt.status !== "pending" && receipt.status !== "complete") ||
      !Number.isSafeInteger(receipt.vectors_remaining) || Number(receipt.vectors_remaining) < 0 ||
      !Number.isSafeInteger(receipt.derived_objects_remaining) || Number(receipt.derived_objects_remaining) < 0 ||
      typeof receipt.object_deleted !== "boolean" ||
      (receipt.status === "complete" && (receipt.vectors_remaining !== 0 || receipt.derived_objects_remaining !== 0 || !receipt.object_deleted))) {
    throw new SearchSphereServiceError(502, "Invalid document cleanup receipt.");
  }
  return {
    documentId, status: receipt.status as "pending" | "complete",
    vectorsRemaining: Number(receipt.vectors_remaining),
    derivedObjectsRemaining: Number(receipt.derived_objects_remaining),
    objectDeleted: receipt.object_deleted,
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
  return queueMedicalDocumentIngestion(
    { ...params, forceReindex: true },
    { ...options, retries: 0 }
  );
}

/**
 * Executes a patient-scoped medical record search against Search Sphere internal retrieval API.
 */
export async function searchPatientMedicalRecords(
  params: MedicalRetrievalSearchParams,
  options?: ClientRequestOptions
): Promise<MedicalRetrievalResponse> {
  return withMedicalQueryDeadline(options, async options => {
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
      { ...options, retries: 0, requestId: params.requestId || options?.requestId }
    );

    if (!response.ok) {
      throw await medicalProviderFailure(response, `Medical retrieval failed (${response.status}): Failed to search patient medical records`);
    }

    const data = await response.json();
    return {
      results: (data.results || []).map((r: any) => {
        const { score: _, ...rest } = r;
        void _;
        return rest;
      }),
    };
  });
}

/**
 * Calls Search Sphere internal medical RAG endpoint to generate a grounded answer.
 */
export async function generatePatientMedicalAnswer(
  params: MedicalRagAnswerParams,
  options?: ClientRequestOptions
): Promise<MedicalRagAnswerResult> {
  return withMedicalQueryDeadline(options, async options => {
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
      { ...options, retries: 0, timeoutMs: Math.min(options?.timeoutMs ?? 55000, 55000), requestId: params.requestId || options?.requestId }
    );

    if (!response.ok) {
      throw await medicalProviderFailure(response, `Medical RAG generation failed (${response.status}): Failed to generate grounded medical answer`);
    }

    const data = await response.json();
    const rawCitations = data.citations || [];
    return {
      answer: data.answer || "",
      citations: sanitizeCitations(rawCitations),
      resultCount: data.resultCount ?? rawCitations.length,
    };
  }, 55000);
}

/**
 * Calls Search Sphere internal medical chat endpoint to generate a multi-turn grounded answer.
 */
export async function generatePatientMedicalChat(
  params: MedicalChatParams,
  options?: ClientRequestOptions
): Promise<MedicalChatResult> {
  return withMedicalQueryDeadline(options, async options => {
    const actorId = medicalActor(params);
    const { baseUrl, secret } = getServiceConfig();

    const response = await fetchWithRetry(
      `${baseUrl}/internal/medical-rag/chat`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "X-Actor-ID": actorId,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          patientId: params.patientId,
          message: params.message,
          conversationId: params.conversationId,
          limit: params.limit ?? 8,
          documentType: params.documentType,
          fromDate: params.fromDate,
          toDate: params.toDate,
        }),
      },
      { ...options, retries: 0, timeoutMs: Math.min(options?.timeoutMs ?? 55000, 55000), requestId: params.requestId || options?.requestId }
    );

    if (!response.ok) {
      throw await medicalProviderFailure(response);
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
      requiresHistory: data.requiresHistory ?? false,
      contextMessageIds: data.contextMessageIds ?? [],
      messageId: data.messageId ?? null,
    };
  }, 55000);
}

/**
 * Initiates a streaming connection with Search Sphere internal medical chat endpoint.
 * Bounded to 55 seconds under the existing 60-second route limit; forwards caller disconnects.
 */
export async function openPatientMedicalChatStream(
  params: MedicalChatParams,
  options?: ClientRequestOptions
): Promise<Response> {
  const actorId = medicalActor(params);
  const { baseUrl, secret } = getServiceConfig();
  const requestId = params.requestId || options?.requestId || getCurrentRequestId() || randomUUID();

  const headers = new Headers();
  const config = getServiceConfig();
  headers.set("Authorization", `Bearer ${secret}`);
  headers.set("X-Client-ID", config.clientId);
  headers.set("X-Tenant-ID", config.tenantId);
  headers.set("X-Subject-ID", params.patientId);
  headers.set("X-Actor-ID", actorId);
  headers.set("X-Collection-ID", patientCollectionId(params.patientId));
  headers.set("Content-Type", "application/json");
  headers.set("Accept", "text/event-stream");
  headers.set("X-Request-ID", requestId);

  const controller = new AbortController();
  const timeoutMs = Math.min(options?.timeoutMs ?? 55000, 55000);
  const timer = setTimeout(() => controller.abort(new Error("Stream timeout")), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/internal/medical-rag/chat/stream`, {
      method: "POST",
      headers,
      signal: options?.signal ? AbortSignal.any([controller.signal, options.signal]) : controller.signal,
      body: JSON.stringify({
        patientId: params.patientId,
        message: params.message,
        conversationId: params.conversationId,
        limit: params.limit ?? 8,
        documentType: params.documentType,
        fromDate: params.fromDate,
        toDate: params.toDate,
      }),
    });

    if (!response.ok) {
      throw await medicalProviderFailure(response);
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
    if (controller.signal.aborted && !options?.signal?.aborted) throw new SearchSphereTimeoutError();
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
