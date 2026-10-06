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
  requestId?: string;
}

export interface MedicalRetrievalChunk {
  score?: number;
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
  requestId?: string;
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
  sourceType?: "OBSERVATION" | "DOCUMENT_CHUNK";
  observationId?: string | null;
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
  requestId?: string;
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
  requestId?: string;
}

export interface MedicalChatResult {
  answer: string;
  citations: MedicalRagCitation[];
  resultCount: number;
  retrievalQuery?: string | null;
  rewritten?: boolean;
  answerMode?: "STRUCTURED" | "RAG" | "HYBRID";
}

export interface MedicalObservationItem {
  id: string;
  type: string;
  displayName: string;
  value: number | null;
  valueText?: string | null;
  secondaryValue?: number | null;
  unit?: string | null;
  observedAt?: string | null;
  reportedAt?: string | null;
  isDateInferred?: boolean;
  documentId: string;
  pageNumber?: number | null;
  chunkIndex?: number | null;
  confidence: number;
}

export interface PatientMedicalObservationsResponse {
  observations: MedicalObservationItem[];
  totalCount: number;
}

export interface QueryPatientMedicalObservationsParams {
  patientId: string;
  observationTypes?: string[];
  fromDate?: string;
  toDate?: string;
  limit?: number;
  sort?: "asc" | "desc";
  requestId?: string;
}

export interface ClientRequestOptions {
  subjectId?: string;
  signal?: AbortSignal;
  requestId?: string;
  timeoutMs?: number;
  retries?: number;
}
