import { describe, expect, it } from "vitest";
import { collectMedicalStreamResult, MedicalStreamFailure } from "@/lib/medical-stream-result";

const citation = { citationId: 1, documentId: "synthetic-doc" };
const frame = (kind: string, value: unknown) => `event: ${kind}\ndata: ${JSON.stringify(value)}\n\n`;
const text = "Public synthetic marker [1].";
const valid = frame("token", { text })+frame("citations", { citations: [citation] })+frame("done", { answer: text, citations: [citation], mode: "RAG" });
function reader(input: string, split = false) {
  return new ReadableStream<Uint8Array>({ start(controller) {
    for (const piece of split ? [...input] : [input]) controller.enqueue(new TextEncoder().encode(piece));
    controller.close();
  } }).getReader();
}

describe("Completed medical stream collection", () => {
  it("preserves only safe provider error codes without upstream content", async () => {
    try {
      await collectMedicalStreamResult(reader(frame("error", { code: "provider_quota", detail: "PRIVATE DIAGNOSTIC" })));
      expect.fail("Expected a terminal provider failure");
    } catch (error) {
      expect(error).toBeInstanceOf(MedicalStreamFailure);
      expect((error as MedicalStreamFailure).code).toBe("provider_quota");
      expect(String(error)).not.toContain("PRIVATE");
    }
  });
  it.each([false, true])("accepts complete matching frames across read boundaries (fragmented=%s)", async (split) => {
    expect(await collectMedicalStreamResult(reader(valid, split))).toEqual({ answer: text, citations: [citation], mode: "RAG" });
  });
  it("parses CRLF and UTF-8 fragments", async () => {
    const bytes = new TextEncoder().encode((frame("token", { text: "Café" })+frame("done", { answer: "Café", citations: [] })).replaceAll("\n", "\r\n"));
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    expect((await collectMedicalStreamResult(stream.getReader())).answer).toBe("Café");
  });
  it.each([
    "", frame("token", { text: "UNVALIDATED PARTIAL" }),
    frame("token", { text: "UNVALIDATED PARTIAL" })+frame("error", { code: "provider_quota", detail: "PRIVATE DIAGNOSTIC" }),
    valid+frame("done", { answer: text }),
    frame("token", { text })+frame("done", { answer: "different answer", citations: [citation] }),
    frame("done", { answer: text, citations: [] }),
    frame("done", { answer: text, citations: [citation, citation] }),
    frame("done", { answer: text, citations: [{ citationId: 1 }] }),
    frame("done", { answer: text, citations: [citation] }).trimEnd(),
    frame("token", { text: "x".repeat(16001) }),
    frame("metadata", { oversized: "x".repeat(131073) }),
  ])("rejects partial, failed, inconsistent or oversized streams", async (input) => {
    await expect(collectMedicalStreamResult(reader(input))).rejects.toThrow();
  });
});
