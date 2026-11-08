import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MedicalReleaseJourney, MEDICAL_RELEASE_ROOT } from "@/lib/medical-release-journey";
import { exerciseMedicalRelease } from "@/lib/medical-release-exercise";
import {
  MedicalReleaseFake,
  medicalTestIdentity,
  medicalTestKey,
} from "@/__tests__/helpers/medical-release-fake";
import { medicalReleaseTitle } from "@/lib/medical-release-journal";
let dir: string, fake: MedicalReleaseFake, logs: string[];
function journey() {
  return new MedicalReleaseJourney(fake.environment(join(dir, "receipts.json")), {
    sessionFactory: fake.factory,
    now: () => fake.time,
    sleep: async (ms) => {
      fake.time += ms;
    },
    log: (value) => logs.push(value),
  });
}
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qc-release-controller-"));
  fake = new MedicalReleaseFake();
  logs = [];
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe("complete authenticated medical release controller", () => {
  it("requires two fresh PDFs, owned retrieval, three grounded answer contracts and verified cleanup", async () => {
    const run = journey();
    await run.run(exerciseMedicalRelease);
    expect(run.journal.entries).toHaveLength(3);
    expect(run.journal.entries.every((row) => row.complete)).toBe(true);
    expect(fake.documents.size).toBe(0);
    expect(fake.threads.size).toBe(0);
    expect(
      fake.calls.filter((call) => call.method === "POST" && call.path === MEDICAL_RELEASE_ROOT),
    ).toHaveLength(2);
    expect(fake.calls.some((call) => call.path.endsWith("/stream"))).toBe(true);
    expect(logs.at(-1)).toMatch(/^PASS authenticated medical/);
    const text = logs.join("\n");
    expect(text).not.toContain(medicalTestKey);
    for (const account of Object.values(medicalTestIdentity.accounts)) {
      expect(text).not.toContain(account.email);
      expect(text).not.toContain(account.password);
    }
    expect(text).not.toContain("verification color is teal");
  });
  it.each([
    "ingestion-failed",
    "ingestion-stuck",
    "foreign-source",
    "authorization-bypass",
    "patient-source-bypass",
    "answer-503",
    "wrong-answer",
    "foreign-citation",
    "sse-incomplete",
    "saved-turn-missing",
  ])("fails on %s and still cleans every created owned fixture", async (fault) => {
    fake.fault = fault;
    const run = journey();
    await expect(run.run(exerciseMedicalRelease)).rejects.toThrow("journey failed");
    expect(fake.documents.size).toBe(0);
    expect(fake.threads.size).toBe(0);
    expect(run.journal.entries.length).toBeGreaterThan(0);
    expect(run.journal.entries.every((row) => row.complete)).toBe(true);
    expect(logs.some((value) => value.startsWith("PASS authenticated"))).toBe(false);
    expect(logs.join("\n")).not.toContain("SYNTHETIC_PRIVATE_ERROR");
  });
  it.each(["lost-upload", "lost-thread"])(
    "recovers signed catalog provenance after a %s response",
    async (fault) => {
      fake.fault = fault;
      const run = journey();
      await expect(run.run(exerciseMedicalRelease)).rejects.toThrow();
      expect(fake.documents.size).toBe(0);
      expect(fake.threads.size).toBe(0);
      expect(run.journal.entries.length).toBeGreaterThan(0);
      expect(run.journal.entries.every((row) => row.complete)).toBe(true);
    },
  );
  it.each(["delete-503", "receipt-503", "vectors-remain", "derived-remains", "object-remains", "wrong-receipt-id"])(
    "fails cleanup on %s and retains incomplete signed receipts for retry",
    async (fault) => {
      fake.fault = fault;
      const run = journey();
      await expect(run.run(exerciseMedicalRelease)).rejects.toThrow();
      expect(run.journal.entries.some((row) => !row.complete)).toBe(true);
      expect(logs.some((value) => value.startsWith("FAIL owned cleanup"))).toBe(true);
      fake.fault = "";
      const recovered = journey();
      await recovered.run(exerciseMedicalRelease);
      expect(recovered.journal.entries.every((row) => row.complete)).toBe(true);
      expect(fake.documents.size).toBe(0);
      expect(fake.threads.size).toBe(0);
    },
  );
  it("recovers a bounded cold start through read-only health requests", async () => {
    fake.fault="cold-health";const run=journey();await run.run(exerciseMedicalRelease);
    expect(fake.calls.filter(call=>call.path==="/health")).toHaveLength(3);
    expect(logs.filter(value=>value.startsWith("WAIT"))).toHaveLength(2);
  });

  it("fails unavailable health after four attempts before login or mutation", async () => {
    fake.fault="health-unavailable";const run=journey();await expect(run.run(exerciseMedicalRelease)).rejects.toThrow();
    expect(fake.calls.filter(call=>call.path==="/health")).toHaveLength(4);
    expect(fake.calls.every(call=>call.method==="GET")).toBe(true);
  });

  it("fails revision verification before login or mutation", async () => {
    fake.fault = "revision";
    const run = journey();
    await expect(run.run(exerciseMedicalRelease)).rejects.toThrow();
    expect(fake.calls.every((call) => call.method === "GET")).toBe(true);
  });
  it("refuses unowned or cross-patient fixture catalogs before model requests or deletion", async () => {
    fake.addDocument("patient-a", "UNAPPROVED SYNTHETIC CATALOG ENTRY");
    const run = journey();
    await expect(run.run(exerciseMedicalRelease)).rejects.toThrow();
    expect(fake.documents.size).toBe(1);
    expect(
      fake.calls.some((call) => call.method === "DELETE" || call.path.endsWith("/medical-answer")),
    ).toBe(false);
  });
  it("does not accept only old completed receipts as a fresh release journey", async () => {
    const run = journey();
    await run.run(exerciseMedicalRelease);
    const again = journey();
    await expect(again.run(async () => {})).rejects.toThrow();
  });
  it("reconciles signed fixtures that predate the current process before creating new documents", async () => {
    fake.addDocument("patient-a", medicalReleaseTitle(medicalTestKey, "a".repeat(32), "patient-a"));
    const run = journey();
    await run.run(exerciseMedicalRelease);
    expect(run.journal.entries).toHaveLength(4);
    expect(run.journal.entries.every((row) => row.complete)).toBe(true);
    const firstDelete = fake.calls.findIndex((call) => call.method === "DELETE");
    const firstUpload = fake.calls.findIndex(
      (call) => call.method === "POST" && call.path === MEDICAL_RELEASE_ROOT,
    );
    expect(firstDelete).toBeLessThan(firstUpload);
  });
});
