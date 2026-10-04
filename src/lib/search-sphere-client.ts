export interface StorageUploadResult {
  storagePath: string;
  mimeType: string;
  fileSize: number;
}

export interface StorageSignedUrlResult {
  url: string;
  expiresIn: number;
}

export interface StorageDeleteResult {
  success: boolean;
  message: string;
}

function getServiceConfig() {
  const secret = process.env.SEARCH_SPHERE_SERVICE_SECRET;
  if (!secret) {
    throw new Error("SEARCH_SPHERE_SERVICE_SECRET is not configured");
  }

  const rawUrl = process.env.SEARCH_SPHERE_API_URL;
  if (!rawUrl) {
    throw new Error("SEARCH_SPHERE_API_URL is not configured");
  }

  const baseUrl = rawUrl.replace(/\/$/, "");
  return { baseUrl, secret };
}


/**
 * Uploads medical document file bytes to Search Sphere internal storage API.
 */
export async function uploadToStorage(params: {
  file: Blob;
  fileName: string;
  patientId: string;
  documentId: string;
}): Promise<StorageUploadResult> {
  const { baseUrl, secret } = getServiceConfig();
  const form = new FormData();

  form.append("file", params.file, params.fileName);
  form.append("patient_id", params.patientId);
  form.append("document_id", params.documentId);

  const response = await fetch(`${baseUrl}/internal/medical-documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to store document in object storage";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
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
  expiresIn: number = 600
): Promise<StorageSignedUrlResult> {
  const { baseUrl, secret } = getServiceConfig();

  const url = new URL(`${baseUrl}/internal/medical-documents/signed-url`);
  url.searchParams.set("storagePath", storagePath);
  url.searchParams.set("expiresIn", expiresIn.toString());

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to generate signed document URL";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
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
  storagePath: string
): Promise<StorageDeleteResult> {
  const { baseUrl, secret } = getServiceConfig();

  const url = new URL(`${baseUrl}/internal/medical-documents`);
  url.searchParams.set("storagePath", storagePath);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to delete document from object storage";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
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

export interface IngestionQueueResult {
  documentId: string;
  status: string;
}

export interface ProcessingStatusResult {
  documentId: string;
  status: string;
  processedAt: string | null;
  error: string | null;
}

export interface IngestionQueueParams {
  documentId: string;
  patientId: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  documentType: string;
  reportDate?: string | Date | null;
}

/**
 * Enqueues a medical document for asynchronous vector extraction and indexing in Search Sphere.
 */
export async function queueMedicalDocumentIngestion(
  params: IngestionQueueParams
): Promise<IngestionQueueResult> {
  const { baseUrl, secret } = getServiceConfig();

  const reportDateStr = params.reportDate
    ? typeof params.reportDate === "string"
      ? params.reportDate
      : params.reportDate.toISOString()
    : null;

  const response = await fetch(
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
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to enqueue medical document for ingestion";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
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
  documentId: string
): Promise<ProcessingStatusResult> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetch(
    `${baseUrl}/internal/medical-documents/${encodeURIComponent(documentId)}/status`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to fetch document processing status";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
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
 * Requests Search Sphere to delete vector embeddings, extracted text, and indexing record for a medical document.
 */
export async function deleteMedicalDocumentIndex(
  documentId: string
): Promise<{ success: boolean; message: string }> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetch(
    `${baseUrl}/internal/medical-documents/${encodeURIComponent(documentId)}/index`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${secret}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to delete medical document vector index";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Vector index deletion failed (${response.status}): ${detail}`);
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
  params: IngestionQueueParams
): Promise<IngestionQueueResult> {
  return queueMedicalDocumentIngestion(params);
}

export interface MedicalRetrievalChunk {
  score: number;
  content: string;
  documentId: string;
  documentType: string;
  reportDate: string | null;
  fileName: string;
  pageNumber: number;
  chunkIndex: number;
  patientId: string;
}

export interface MedicalRetrievalResponse {
  results: MedicalRetrievalChunk[];
}

export interface MedicalRetrievalSearchParams {
  patientId: string;
  query: string;
  limit?: number;
  documentType?: string;
  fromDate?: string;
  toDate?: string;
}

/**
 * Executes a patient-scoped medical record search against Search Sphere internal retrieval API.
 */
export async function searchPatientMedicalRecords(
  params: MedicalRetrievalSearchParams
): Promise<MedicalRetrievalResponse> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetch(`${baseUrl}/internal/medical-retrieval/search`, {
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to search patient medical records";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Medical retrieval failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    results: data.results || [],
  };
}

export interface MedicalRagCitation {
  citationId: number;
  documentId: string;
  fileName: string;
  documentType: string;
  reportDate: string | null;
  pageNumber: number | null;
  chunkIndex: number | null;
  content?: string | null;
  score?: number | null;
}

export interface MedicalRagAnswerResult {
  answer: string;
  citations: MedicalRagCitation[];
  resultCount: number;
}

export interface MedicalRagAnswerParams {
  patientId: string;
  query: string;
  limit?: number;
  documentType?: string;
  fromDate?: string;
  toDate?: string;
}

/**
 * Calls Search Sphere internal medical RAG endpoint to generate a grounded answer
 * based solely on indexed, verified medical documents belonging to the specified patient.
 */
export async function generatePatientMedicalAnswer(
  params: MedicalRagAnswerParams
): Promise<MedicalRagAnswerResult> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetch(`${baseUrl}/internal/medical-rag/answer`, {
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to generate grounded medical answer";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Medical RAG generation failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    answer: data.answer || "",
    citations: data.citations || [],
    resultCount: data.resultCount ?? (data.citations ? data.citations.length : 0),
  };
}

export interface MedicalChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface MedicalChatParams {
  patientId: string;
  message: string;
  history?: MedicalChatMessage[];
  limit?: number;
  documentType?: string;
  fromDate?: string;
  toDate?: string;
}

export interface MedicalChatResult {
  answer: string;
  citations: MedicalRagCitation[];
  resultCount: number;
  retrievalQuery?: string | null;
  rewritten?: boolean;
}

/**
 * Calls Search Sphere internal medical chat endpoint to generate a multi-turn grounded answer.
 */
export async function generatePatientMedicalChat(
  params: MedicalChatParams
): Promise<MedicalChatResult> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetch(`${baseUrl}/internal/medical-rag/chat`, {
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to generate medical chat answer";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Medical chat generation failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    answer: data.answer || "",
    citations: data.citations || [],
    resultCount: data.resultCount ?? (data.citations ? data.citations.length : 0),
    retrievalQuery: data.retrievalQuery ?? null,
    rewritten: data.rewritten ?? false,
  };
}

/**
 * Initiates a streaming connection with Search Sphere internal medical chat endpoint.
 * Returns the raw Fetch Response whose body can be streamed.
 */
export async function openPatientMedicalChatStream(
  params: MedicalChatParams
): Promise<Response> {
  const { baseUrl, secret } = getServiceConfig();

  const response = await fetch(`${baseUrl}/internal/medical-rag/chat/stream`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
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
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to initiate medical chat stream";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Medical chat streaming failed (${response.status}): ${detail}`);
  }

  return response;
}

