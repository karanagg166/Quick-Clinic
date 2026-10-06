/** Opt-in synthetic lifecycle against a running Search-Sphere API and worker. */
import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  uploadToStorage, queueMedicalDocumentIngestion, getMedicalDocumentProcessingStatus,
  searchPatientMedicalRecords, generatePatientMedicalAnswer, generatePatientMedicalChat,
  openPatientMedicalChatStream, queryPatientMedicalObservations, deleteMedicalDocumentIndex,
  deleteFromStorage, getSignedStorageUrl, patientCollectionId,
} from "@/lib/search-sphere-client";

function syntheticPdf(lines: string[]): Blob {
  const stream = "BT /F1 12 Tf 50 740 Td " + lines.map((line, i) => `${i ? "0 -20 Td " : ""}(${line.replace(/[()\\]/g, "\\$&")}) Tj`).join("\n") + " ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${n.toString().padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Blob([pdf], { type: "application/pdf" });
}

const live = process.env.RUN_SEARCH_SPHERE_INTEGRATION === "1";
describe.skipIf(!live)("live Search-Sphere synthetic medical lifecycle", () => {
  it("uploads, indexes, retrieves through both contracts, answers, chats, streams, observes, isolates and deletes", async () => {
    if (!process.env.SEARCH_SPHERE_API_KEY) throw new Error("Provision the scoped quick_clinic service client first");
    const suffix = randomUUID();
    const patientA = `synthetic-patient-a-${suffix}`;
    const patientB = `synthetic-patient-b-${suffix}`;
    const docs = [{ patient: patientA, id: `synthetic-a-${suffix}`, lines: ["Synthetic Lab Report", "HbA1c: 7.4%", "Fasting glucose: 142 mg/dL", "Report Date: 2026-09-12", "Physician note: Patient reports increased thirst."] }, { patient: patientB, id: `synthetic-b-${suffix}`, lines: ["Synthetic Lab Report", "HbA1c: 5.1%", "Physician note: Patient reports no symptoms."] }];
    const stored: { patient: string; id: string; storagePath: string; indexed: boolean }[] = [];
    const base = process.env.SEARCH_SPHERE_API_URL!.replace(/\/$/, "");
    const headers = { Authorization: `Bearer ${process.env.SEARCH_SPHERE_API_KEY}`, "Content-Type": "application/json", "X-Client-ID": "quick_clinic", "X-Tenant-ID": process.env.SEARCH_SPHERE_TENANT_ID || "quick_clinic_default", "X-Subject-ID": patientA, "X-Collection-ID": patientCollectionId(patientA), "X-Request-ID": randomUUID() };
    try {
      for (const doc of docs) {
        const file = syntheticPdf(doc.lines);
        const storage = await uploadToStorage({ file, fileName: "synthetic-report.pdf", patientId: doc.patient, documentId: doc.id });
        const tracked = { patient: doc.patient, id: doc.id, storagePath: storage.storagePath, indexed: false };
        stored.push(tracked);
        await queueMedicalDocumentIngestion({ documentId: doc.id, patientId: doc.patient, ...storage, fileName: "synthetic-report.pdf", documentType: "LAB_REPORT", reportDate: "2026-09-12" });
        tracked.indexed = true;
        const deadline = Date.now() + 180_000;
        let status = "QUEUED";
        while (Date.now() < deadline) {
          status = (await getMedicalDocumentProcessingStatus(doc.id, { subjectId: doc.patient })).status;
          if (status === "READY" || status === "FAILED") break;
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        expect(status).toBe("READY");
      }
      for (const query of ["HbA1c 7.4", "What was the patient's long-term blood sugar marker?", "What symptom did the patient report?"]) {
        const legacy = await searchPatientMedicalRecords({ patientId: patientA, query });
        expect(legacy.results.length).toBeGreaterThan(0);
        expect(legacy.results.every(chunk => chunk.patientId === patientA && chunk.documentId === docs[0].id)).toBe(true);
        const generic = await fetch(`${base}/api/v1/search`, { method: "POST", headers, body: JSON.stringify({ query }) });
        expect(generic.status).toBe(200);
        const result = await generic.json();
        expect(result.results.length).toBeGreaterThan(0);
        expect(result.results.every((chunk: { document_id: string; owner_subject_id: string }) => chunk.document_id === docs[0].id && chunk.owner_subject_id === patientA)).toBe(true);
      }
      for (const body of [{ query: "glucose", owner_subject_id: patientB }, { query: "glucose", collection_id: patientCollectionId(patientB) }]) {
        expect((await fetch(`${base}/api/v1/search`, { method: "POST", headers, body: JSON.stringify(body) })).status).toBe(403);
      }
      expect((await fetch(`${base}/internal/medical-documents/${docs[1].id}/status`, { headers })).status).toBe(403);
      expect((await fetch(`${base}/api/v1/search`, { method: "POST", headers: { ...headers, "X-Client-ID": "exam_arena" }, body: JSON.stringify({ query: "glucose" }) })).status).toBe(403);
      expect((await fetch(`${base}/api/v1/search`, { method: "POST", headers: { ...headers, "X-Tenant-ID": "unauthorized" }, body: JSON.stringify({ query: "glucose" }) })).status).toBe(403);
      const observations = await queryPatientMedicalObservations({ patientId: patientA, observationTypes: ["HBA1C"] });
      expect(observations.observations.some(o => o.value === 7.4 && o.documentId === docs[0].id)).toBe(true);
      if (process.env.RUN_SEARCH_SPHERE_COHERE_SMOKE === "1") {
        const answer = await generatePatientMedicalAnswer({ patientId: patientA, query: "What symptom was reported?" });
        expect(answer.answer.toLowerCase()).toContain("thirst");
        expect(answer.citations.length).toBeGreaterThan(0);
        expect(answer.citations.every(c => c.documentId === docs[0].id && c.pageNumber === 1 && c.chunkIndex !== null)).toBe(true);
        const missing = await generatePatientMedicalAnswer({ patientId: patientA, query: "What was this patient's MRI diagnosis?" });
        expect(missing.answer).toMatch(/not|couldn.t|no .*found|available records/i);
        const first = await generatePatientMedicalChat({ patientId: patientA, message: "What was the latest HbA1c?" });
        expect(first.answer).toContain("7.4");
        const history = [{ role: "user" as const, content: "What was the latest HbA1c?" }, { role: "assistant" as const, content: first.answer }];
        const follow = await generatePatientMedicalChat({ patientId: patientA, message: "When was it measured?", history });
        expect(follow.citations.every(c => c.documentId === docs[0].id)).toBe(true);
        const hybrid = await generatePatientMedicalChat({ patientId: patientA, message: "What was the latest HbA1c, and what symptom was reported in the physician note?" });
        expect(hybrid.answer).toContain("7.4");
        expect(hybrid.answer.toLowerCase()).toContain("thirst");
        const stream = await openPatientMedicalChatStream({ patientId: patientA, message: "What symptom did the patient report?" });
        expect(stream.headers.get("content-type")).toContain("text/event-stream");
        const events = await stream.text();
        expect(events).toContain("citations");
        expect(events).toMatch(/done|DONE/i);
      }
      await deleteMedicalDocumentIndex(docs[0].id, { subjectId: patientA });
      stored[0].indexed = false;
      await deleteFromStorage(stored[0].storagePath);
      expect((await searchPatientMedicalRecords({ patientId: patientA, query: "HbA1c" })).results).toEqual([]);
      await expect(getMedicalDocumentProcessingStatus(docs[0].id, { subjectId: patientA })).rejects.toThrow();
      await expect(getSignedStorageUrl(stored[0].storagePath)).rejects.toThrow();
      expect((await queryPatientMedicalObservations({ patientId: patientA })).observations).toEqual([]);
    } finally {
      for (const doc of stored) {
        await Promise.allSettled([
          ...(doc.indexed ? [deleteMedicalDocumentIndex(doc.id, { subjectId: doc.patient })] : []),
          deleteFromStorage(doc.storagePath),
        ]);
      }
    }
  }, 420_000);
});
