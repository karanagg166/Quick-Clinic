import "server-only";
import type { MedicalRagCitation } from "@/types/search-sphere";

export class MedicalStreamFailure extends Error {
  readonly code: string;
  constructor(code: unknown) {
    super("Medical provider stream failed.");
    this.code = typeof code === "string" && ["provider_timeout", "provider_quota", "provider_rate_limit", "provider_not_approved", "provider_invalid_response", "provider_unavailable"].includes(code)
      ? code : "provider_unavailable";
  }
}

/** Buffer the completed, bounded upstream result before local access validation. */
export async function collectMedicalStreamResult(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let answer = "";
  let citations: MedicalRagCitation[] = [];
  let seenCitations = false;
  let completed = false;
  let bytes = 0;
  let mode: string | null = null;

  const dispatch = (frame: string) => {
    if (!frame.trim()) return;
    let kind = "message";
    const lines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("event:")) kind = line.slice(6).trim();
      if (line.startsWith("data:")) lines.push(line.slice(5).trimStart());
    }
    if (!lines.length) return;
    if (completed) throw new Error("Unexpected content after stream completion.");
    const value = JSON.parse(lines.join("\n"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid stream frame.");
    if (kind === "error") throw new MedicalStreamFailure(value.code);
    if (kind === "token") {
      if (typeof value.text !== "string") throw new Error("Invalid stream token.");
      answer += value.text;
      if (answer.length > 16000) throw new Error("Medical answer exceeds output limit.");
    } else if (kind === "citations") {
      if (seenCitations || !Array.isArray(value.citations)) throw new Error("Invalid stream citations.");
      citations = value.citations;
      seenCitations = true;
    } else if (kind === "done") {
      if (typeof value.answer !== "string" || !value.answer.trim() || value.answer.length > 16000 || (answer && answer !== value.answer)) {
        throw new Error("Medical stream completion does not match its tokens.");
      }
      answer = value.answer;
      if (value.citations !== undefined) {
        if (!Array.isArray(value.citations) || (seenCitations && JSON.stringify(citations) !== JSON.stringify(value.citations))) {
          throw new Error("Medical stream citation completion mismatch.");
        }
        citations = value.citations;
      }
      mode = typeof value.mode === "string" ? value.mode : null;
      completed = true;
    } else if (kind !== "metadata") {
      throw new Error("Unsupported medical stream event.");
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 131072) throw new Error("Medical stream exceeds its bounded size.");
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || "";
    for (const frame of frames) dispatch(frame);
  }
  buffer += decoder.decode();
  if (buffer.trim()) throw new Error("Medical stream ended with an incomplete frame.");
  if (!completed) throw new Error("Medical stream did not complete.");
  if (citations.length > 20 || citations.some((citation) =>
    !citation || typeof citation !== "object" || typeof citation.documentId !== "string" || !citation.documentId ||
    !Number.isSafeInteger(citation.citationId) || citation.citationId <= 0
  ) || new Set(citations.map((citation) => citation.citationId)).size !== citations.length) {
    throw new Error("Invalid medical citation identities.");
  }
  const cited = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  if ((citations.length > 0 && cited.length === 0) || cited.some((id) => !citations.some((citation) => citation.citationId === id))) {
    throw new Error("Unsupported medical answer citation.");
  }
  return { answer, citations, mode };
}
