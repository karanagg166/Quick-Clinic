/** Independent expected-answer and downstream SSE assertions for public fixtures. */
type Color = "teal" | "amber";
export function requireMedicalRelease(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
export function medicalReleaseObject(value: unknown): Record<string, unknown> {
  requireMedicalRelease(
    !!value && typeof value === "object" && !Array.isArray(value),
    "Invalid release response object.",
  );
  return value as Record<string, unknown>;
}
export function verifyMedicalReleaseAnswer(
  answer: unknown,
  citations: unknown,
  documentId: string,
  marker: string,
  color: Color,
) {
  requireMedicalRelease(
    typeof answer === "string" && answer.length <= 16000,
    "Missing bounded grounded answer.",
  );
  const plain = answer.toLowerCase().replace(/\*+/g, "");
  const colorClauses = plain
    .split(/[.!?;\n]/)
    .filter((clause) => new RegExp("\\b" + color + "\\b").test(clause));
  requireMedicalRelease(
    colorClauses.length > 0 &&
      colorClauses.every(
        (clause) =>
          !/\b(?:not|never|cannot|unknown|unavailable|insufficient|unclear|isn't)\b/.test(clause),
      ),
    "Expected positive synthetic answer missing.",
  );
  requireMedicalRelease(
    !new RegExp("\\b" + (color === "teal" ? "amber" : "teal") + "\\b").test(plain),
    "Foreign fixture answer returned.",
  );
  requireMedicalRelease(
    Array.isArray(citations) && citations.length > 0 && citations.length <= 20,
    "Supporting citations required.",
  );
  const identifiers = new Set<number>();
  for (const value of citations) {
    const citation = medicalReleaseObject(value);
    requireMedicalRelease(
      citation.documentId === documentId &&
        citation.pageNumber === 1 &&
        Number.isSafeInteger(citation.citationId) &&
        Number(citation.citationId) > 0,
      "Unauthorized or invalid page citation.",
    );
    requireMedicalRelease(
      typeof citation.content === "string" &&
        citation.content.includes(marker) &&
        citation.content.toLowerCase().includes(color),
      "Citation does not support the unique fixture fact.",
    );
    requireMedicalRelease(
      !identifiers.has(Number(citation.citationId)) && !("score" in citation),
      "Duplicate or internal citation metadata.",
    );
    identifiers.add(Number(citation.citationId));
  }
  const cited = [...answer.matchAll(/\[(\d+)\]/g)].map((match) => Number(match[1]));
  requireMedicalRelease(
    cited.length > 0 &&
      cited.every((id) => identifiers.has(id)) &&
      [...identifiers].every((id) => cited.includes(id)),
    "Fabricated or unused citation reference.",
  );
}

export function parseMedicalReleaseStream(text: string, conversationId: string) {
  requireMedicalRelease(
    Buffer.byteLength(text) <= 262144 && /\r?\n\r?\n$/.test(text),
    "Incomplete or oversized SSE response.",
  );
  let started = false,
    completed = false,
    seenCitations = false,
    answer = "",
    messageId = "";
  let citations: unknown = null;
  for (const frame of text.split(/\r?\n\r?\n/).filter((frame) => frame.trim())) {
    requireMedicalRelease(!completed, "Unexpected event after SSE completion.");
    const lines = frame.split(/\r?\n/);
    const kinds = lines.filter((line) => line.startsWith("event:"));
    requireMedicalRelease(kinds.length === 1, "Missing unambiguous SSE event.");
    const kind = kinds[0].slice(6).trim();
    const raw = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    const value = medicalReleaseObject(JSON.parse(raw));
    if (kind === "start") {
      requireMedicalRelease(
        !started && value.conversationId === conversationId,
        "SSE thread identity mismatch.",
      );
      started = true;
    } else if (kind === "token") {
      requireMedicalRelease(
        started && !seenCitations && typeof value.text === "string",
        "Invalid SSE token order.",
      );
      answer += value.text;
    } else if (kind === "citations") {
      requireMedicalRelease(
        started && !!answer && !seenCitations && Array.isArray(value.citations),
        "Invalid SSE citation order.",
      );
      citations = value.citations;
      seenCitations = true;
    } else if (kind === "done") {
      requireMedicalRelease(
        started &&
          !!answer &&
          seenCitations &&
          typeof value.messageId === "string" &&
          /^[a-z][a-z0-9]{20,31}$/.test(value.messageId),
        "Missing saved SSE completion.",
      );
      messageId = value.messageId;
      completed = true;
    } else throw new Error("Failed or unknown SSE event.");
  }
  requireMedicalRelease(completed, "SSE did not complete.");
  return { answer, citations, messageId };
}

export function medicalReleasePdf(marker: string, color: Color): Uint8Array {
  requireMedicalRelease(
    /^[A-Z0-9_-]{8,100}$/.test(marker) && ["teal", "amber"].includes(color),
    "Invalid synthetic PDF fixture.",
  );
  const lines = [
    "Public synthetic verification note. No actual patient or clinical encounter.",
    "Release marker " + marker + ". The verification color is " + color + ".",
  ];
  const stream =
    "BT /F1 10 Tf 32 740 Td " + lines.map((line) => "(" + line + ") Tj").join(" 0 -22 Td ") + " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 900 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let data = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((value, index) => {
    offsets.push(Buffer.byteLength(data));
    data += `${index + 1} 0 obj\n${value}\nendobj\n`;
  });
  const start = Buffer.byteLength(data);
  data +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets.map((offset) => offset.toString().padStart(10, "0") + " 00000 n \n").join("");
  return Buffer.from(data + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}
