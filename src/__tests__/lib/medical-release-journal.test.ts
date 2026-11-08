import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, symlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MedicalReleaseJournal,
  medicalReleaseTitle,
  ownedMedicalReleaseTitle,
} from "@/lib/medical-release-journal";

const key = "synthetic-ownership-key-for-private-release-tests-only";
const run = "a".repeat(32);
let dir: string, path: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qc-release-journal-"));
  path = join(dir, "receipts.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
describe("signed medical fixture provenance", () => {
  it("restores interrupted document/thread receipts without any credentials or passages", () => {
    const journal = new MedicalReleaseJournal(path, key);
    journal.add("document", randomUUID(), "patient-a", medicalReleaseTitle(key, run, "patient-a"));
    journal.add(
      "conversation",
      "c" + "b".repeat(24),
      "conversation-a",
      medicalReleaseTitle(key, run, "conversation-a"),
    );
    const restored = new MedicalReleaseJournal(path, key);
    expect(restored.entries).toEqual(journal.entries);
    expect(restored.entries.every((row) => !row.complete)).toBe(true);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).not.toContain(key);
  });
  it("keeps verified completion over older pending imports, but rechecks rediscovered metadata", () => {
    const journal = new MedicalReleaseJournal(path, key);
    const id = randomUUID();
    const title = medicalReleaseTitle(key, run, "patient-a");
    journal.add("document", id, "patient-a", title);
    const older = join(dir, "older.json");
    writeFileSync(older, readFileSync(path), { mode: 0o600 });
    journal.complete("document", id);
    journal.importPath(older);
    expect(journal.entries[0].complete).toBe(true);
    journal.add("document", id, "patient-a", title);
    expect(journal.entries[0].complete).toBe(false);
  });
  it.each(["id", "label", "title", "complete", "signature"])(
    "rejects tampered receipt %s",
    (field) => {
      const journal = new MedicalReleaseJournal(path, key);
      journal.add(
        "document",
        randomUUID(),
        "patient-a",
        medicalReleaseTitle(key, run, "patient-a"),
      );
      const value = JSON.parse(readFileSync(path, "utf8"));
      value.entries[0][field] =
        field === "complete" ? true : field === "id" ? randomUUID() : "changed";
      writeFileSync(path, JSON.stringify(value));
      expect(() => new MedicalReleaseJournal(path, key)).toThrow();
    },
  );
  it("refuses another owner's journal, unsigned titles and mismatched resource kinds", () => {
    const journal = new MedicalReleaseJournal(path, key);
    journal.save();
    expect(() => new MedicalReleaseJournal(path, key + "other")).toThrow();
    expect(ownedMedicalReleaseTitle(key, "QC_SS_V1_unowned")).toBeNull();
    const title = medicalReleaseTitle(key, run, "patient-a");
    expect(ownedMedicalReleaseTitle(key + "other", title)).toBeNull();
    expect(() => journal.add("conversation", "c" + "a".repeat(24), "patient-a", title)).toThrow();
    expect(() => journal.add("document", randomUUID(), "patient-b", title)).toThrow();
    expect(() => journal.complete("document", randomUUID())).toThrow();
  });
  it("rejects conflicting IDs and validates complete imports before accepting any rows", () => {
    const journal = new MedicalReleaseJournal(path, key);
    const id = randomUUID();
    journal.add("document", id, "patient-a", medicalReleaseTitle(key, run, "patient-a"));
    expect(() =>
      journal.add("document", id, "patient-b", medicalReleaseTitle(key, run, "patient-b")),
    ).toThrow("Conflicting");
    const before = journal.entries;
    const bad = join(dir, "bad.json");
    const value = JSON.parse(readFileSync(path, "utf8"));
    value.entries.push({ unowned: true });
    writeFileSync(bad, JSON.stringify(value), { mode: 0o600 });
    expect(() => journal.importPath(bad)).toThrow();
    expect(journal.entries).toEqual(before);
  });
  it("bounds receipt growth and never discards unresolved provenance", () => {
    const journal = new MedicalReleaseJournal(path,key);
    for (let index=0;index<128;index++) journal.add("document",randomUUID(),"patient-a",medicalReleaseTitle(key,run,"patient-a"));
    expect(journal.remaining).toBe(0);
    expect(()=>journal.add("document",randomUUID(),"patient-a",medicalReleaseTitle(key,run,"patient-a"))).toThrow("reconciliation");
    expect(new MedicalReleaseJournal(path,key).entries).toHaveLength(128);
    expect(journal.entries.every(row=>!row.complete)).toBe(true);
  });

  it("refuses symlinks and missing/weak ownership keys", () => {
    const original = join(dir, "original.json");
    writeFileSync(original, "{}", { mode: 0o600 });
    symlinkSync(original, path);
    expect(() => new MedicalReleaseJournal(path, key)).toThrow();
    expect(() => medicalReleaseTitle("short", run, "patient-a")).toThrow();
  });
});
