import "server-only";
import { prisma } from "@/lib/prisma";
import { getMedicalDocumentProcessingStatus } from "@/lib/search-sphere-client";

const UNAVAILABLE = "This answer is unavailable because its source access or version cannot be verified.";
interface StoredMessage {
  role: string;
  content: string;
  citations: unknown;
  status: string;
}
interface Source { documentId: string; versionId: string }

function sources(message: StoredMessage): Source[] | null {
  if (message.content.length > 16000 || message.status !== "COMPLETE" || !Array.isArray(message.citations) || !message.citations.length || message.citations.length > 20) return null;
  const result: Source[] = [];
  for (const value of message.citations) {
    if (!value || typeof value !== "object" || typeof value.documentId !== "string" || !value.documentId ||
        typeof value.versionId !== "string" || !value.versionId || value.documentId.length > 255 || value.versionId.length > 255) return null;
    result.push({ documentId: value.documentId, versionId: value.versionId });
  }
  return result;
}

/** Revalidate cached answers without sending messages or records to a model. */
export async function authorizedMedicalHistory<T extends StoredMessage>(patientId: string, messages: T[], signal?: AbortSignal): Promise<T[]> {
  const references = new Map<T, Source[] | null>();
  for (const message of messages) if (message.role === "ASSISTANT") references.set(message, sources(message));
  const documentIds = [...new Set([...references.values()].flatMap((value) => value?.map((source) => source.documentId) ?? []))];
  const verified = new Map<string, string>();
  // Bound metadata work for old conversations. An overlarge history fails closed;
  // it must never trigger an unbounded series of upstream requests.
  if (documentIds.length && documentIds.length <= 20) {
    const documents = await prisma.medicalDocument.findMany({
      where: { id: { in: documentIds }, patientId }, select: { id: true },
    });
    const owned = new Set(documents.map((document) => document.id));
    const pending = documentIds.filter((id) => owned.has(id));
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 8000);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, async () => {
        while (pending.length && !combinedSignal.aborted) {
          const id = pending.shift()!;
          try {
            const current = await getMedicalDocumentProcessingStatus(id, { subjectId: patientId, signal: combinedSignal, timeoutMs: 3000, retries: 0 });
            if (!combinedSignal.aborted && current.documentId === id && current.status === "READY" && current.currentVersionId) verified.set(id, current.currentVersionId);
          } catch { /* Unavailable metadata withholds cached evidence; never returns stale text. */ }
        }
      }));
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
    // The local document may have been removed or moved while metadata was read.
    const remaining = await prisma.medicalDocument.findMany({
      where: { id: { in: [...verified.keys()] }, patientId }, select: { id: true },
    });
    const permitted = new Set(remaining.map((document) => document.id));
    for (const id of verified.keys()) if (!permitted.has(id)) verified.delete(id);
  }
  return messages.map((message) => {
    if (message.role !== "ASSISTANT") return message;
    const evidence = references.get(message);
    if (evidence?.length && evidence.every((source) => verified.get(source.documentId) === source.versionId)) return message;
    return { ...message, content: UNAVAILABLE, citations: [], status: "FAILED" };
  });
}
