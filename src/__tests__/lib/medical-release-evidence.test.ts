import { describe, expect, it } from "vitest";
import {
  medicalReleasePdf,
  parseMedicalReleaseStream,
  verifyMedicalReleaseAnswer,
  MedicalReleaseAssertion,
  MedicalReleaseUpstreamFailure,
  requireMedicalRelease,
  requireMedicalReleaseStatus,
} from "@/lib/medical-release-evidence";

const doc = "a".repeat(8) + "-aaaa-aaaa-aaaa-" + "a".repeat(12);
const marker = "QC_MEDICAL_PUBLIC_A_42";
const citations = [
  {
    citationId: 1,
    documentId: doc,
    pageNumber: 1,
    content: marker + ". The verification color is teal.",
  },
];
const thread = "c" + "a".repeat(24),
  message = "c" + "b".repeat(24);
function event(kind: string, value: unknown) {
  return "event: " + kind + "\ndata: " + JSON.stringify(value) + "\n\n";
}
function completed() {
  return (
    event("start", { conversationId: thread }) +
    event("token", { text: "The verification color is teal. [1]" }) +
    event("citations", { citations }) +
    event("done", { messageId: message })
  );
}
describe("independent medical synthetic evidence assertions", () => {
  it("requires the expected positive fact and exact owned source/page/marker", () => {
    expect(() =>
      verifyMedicalReleaseAnswer(
        "The verification color is **teal**. [1]",
        citations,
        doc,
        marker,
        "teal",
      ),
    ).not.toThrow();
    expect(() =>
      verifyMedicalReleaseAnswer(
        "The color is teal. [1] This is not actual clinical advice.",
        citations,
        doc,
        marker,
        "teal",
      ),
    ).not.toThrow();
  });
  it.each([
    "The color is not teal. [1]",
    "The color is amber. [1]",
    "Unknown whether the color is teal. [1]",
    "The color is teal. [99]",
    "The color is teal.",
  ])("rejects unsupported or incomplete answer: %s", (answer) => {
    expect(() => verifyMedicalReleaseAnswer(answer, citations, doc, marker, "teal")).toThrow();
  });
  it.each([
    [{ ...citations[0], documentId: "foreign-document" }],
    [{ ...citations[0], pageNumber: 2 }],
    [{ ...citations[0], content: "Another marker has color teal." }],
    [{ ...citations[0], content: marker + ". The color is amber." }],
    [{ ...citations[0], score: 0.99 }],
    [...citations, ...citations],
    [],
  ].map(value=>({value})))("rejects invalid source permissions, page, support or citation metadata", ({value}) => {
    expect(() =>
      verifyMedicalReleaseAnswer("The color is teal. [1]", value, doc, marker, "teal"),
    ).toThrow();
  });
  it("requires downstream start/token/citations/done and a saved message ID", () => {
    const result = parseMedicalReleaseStream(completed(), thread);
    expect(result.messageId).toBe(message);
    verifyMedicalReleaseAnswer(result.answer, result.citations, doc, marker, "teal");
  });
  it.each([
    "",
    event("token", { text: "teal" }),
    event("start", { conversationId: "foreign" }),
    event("start", { conversationId: thread }) + event("error", { code: "provider_timeout" }),
    completed().replace(event("done", { messageId: message }), ""),
    completed().trim(),
    completed() + event("token", { text: "late" }),
    completed().replace(message, ""),
    completed().replace("event: citations", "event: unregistered"),
  ])("rejects failed, incomplete, foreign or malformed SSE", (text) => {
    expect(() => parseMedicalReleaseStream(text, thread)).toThrow();
  });
  it("keeps assertion diagnostics within a fixed vocabulary", () => {
    expect.assertions(3);
    try { requireMedicalRelease(false, "Citation does not support the unique fixture fact."); }
    catch (error) {
      expect(error).toBeInstanceOf(MedicalReleaseAssertion);
      expect((error as MedicalReleaseAssertion).code).toBe("citation_support");
    }
    try { requireMedicalRelease(false, "SYNTHETIC_PRIVATE_ERROR"); }
    catch (error) { expect((error as MedicalReleaseAssertion).code).toBe("assertion_failed"); }
  });
  it.each(["provider_timeout", "provider_quota", "provider_not_approved", "invalid_stream", "access_revoked"])(
    "preserves only allowlisted HTTP/SSE failure category %s", (code) => {
      for (const action of [
        () => requireMedicalReleaseStatus({ status: 503, value: { code, error: "SYNTHETIC_PRIVATE_ERROR" } }, 200, "Expected answer failed."),
        () => parseMedicalReleaseStream(event("start", { conversationId: thread }) + event("error", { code }), thread),
      ]) {
        try { action(); throw new Error("Expected failure"); }
        catch (error) {
          expect(error).toBeInstanceOf(MedicalReleaseUpstreamFailure);
          expect((error as MedicalReleaseUpstreamFailure).code).toBe(code);
          expect((error as Error).message).not.toContain("SYNTHETIC_PRIVATE_ERROR");
        }
      }
    },
  );
  it.each(["SYNTHETIC_PRIVATE_ERROR", { token: "SYNTHETIC_PRIVATE_ERROR" }, null])(
    "never exposes unknown provider category values", (code) => {
      const error = new MedicalReleaseUpstreamFailure(Number.NaN, code);
      expect(error.code).toBe("upstream_unavailable");
      expect(error.status).toBe(0);
      expect(JSON.stringify(error)).not.toContain("SYNTHETIC_PRIVATE_ERROR");
    },
  );
  it("builds a bounded native PDF containing only the public synthetic fact", () => {
    const pdf = Buffer.from(medicalReleasePdf(marker, "teal"));
    expect(pdf.toString("ascii")).toMatch(/^%PDF-1.4/);
    expect(pdf.toString("ascii")).toContain(marker);
    expect(pdf.toString("ascii")).toContain("verification color is teal");
    expect(pdf.byteLength).toBeLessThan(2000);
    expect(() => medicalReleasePdf("untrusted (pdf)", "teal")).toThrow();
  });
});
