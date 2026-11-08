/** Signed, content-free fixture provenance for interrupted medical release runs. */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { lstatSync, renameSync, unlinkSync } from "node:fs";
import { readMedicalReleaseFile, writeMedicalReleaseFile } from "./medical-release-files";

type Kind = "document" | "conversation";
type Label = "patient-a" | "patient-b" | "conversation-a";
type Entry = { kind: Kind; id: string; label: Label; title: string; complete: boolean };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const CUID = /^[a-z][a-z0-9]{20,31}$/;
const LIMIT = 128;
function signature(key: string, value: string) {
  if (typeof key !== "string" || Buffer.byteLength(key) < 32)
    throw new Error("Private fixture ownership key required.");
  return createHmac("sha256", key)
    .update("quick-clinic-medical-journey-v1:" + value)
    .digest("hex");
}
function equal(a: string, b: string) {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
export function medicalReleaseTitle(key: string, run: string, label: Label) {
  if (!/^[a-f0-9]{32}$/.test(run) || !["patient-a", "patient-b", "conversation-a"].includes(label))
    throw new Error("Invalid fixture title identity.");
  const value = "QC_SS_V1_" + run + "_" + label;
  return value + "_" + signature(key, value).slice(0, 24);
}
export function ownedMedicalReleaseTitle(key: string, value: unknown): Label | null {
  if (typeof value !== "string") return null;
  const match =
    /^QC_SS_V1_([a-f0-9]{32})_(patient-a|patient-b|conversation-a)_([a-f0-9]{24})$/.exec(value);
  if (!match) return null;
  const label = match[2] as Label;
  return equal(value, medicalReleaseTitle(key, match[1], label)) ? label : null;
}
function requireEntry(key: string, entry: Entry) {
  if (
    typeof entry.id !== "string" ||
    typeof entry.title !== "string" ||
    typeof entry.complete !== "boolean" ||
    ownedMedicalReleaseTitle(key, entry.title) !== entry.label ||
    !(entry.kind === "document"
      ? UUID.test(entry.id) && ["patient-a", "patient-b"].includes(entry.label)
      : entry.kind === "conversation" && CUID.test(entry.id) && entry.label === "conversation-a")
  ) {
    throw new Error("Unowned or invalid fixture receipt.");
  }
}
function seal(key: string, entry: Entry) {
  requireEntry(key, entry);
  const canonical = JSON.stringify([
    entry.kind,
    entry.id,
    entry.label,
    entry.title,
    entry.complete,
  ]);
  return { ...entry, signature: signature(key, "entry:" + canonical) };
}
function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, expected: string[]) {
  return Object.keys(value).sort().join(",") === expected.sort().join(",");
}

export class MedicalReleaseJournal {
  private readonly records = new Map<string, Entry>();
  constructor(
    private readonly path: string,
    private readonly key: string,
  ) {
    signature(key, "owner");
    if (lstatSync(path, { throwIfNoEntry: false })) this.importPath(path);
  }
  get entries(): readonly Entry[] {
    return [...this.records.values()].map((entry) => ({ ...entry }));
  }
  get remaining(): number {
    return LIMIT - this.records.size;
  }

  importPath(path: string) {
    const value: unknown = JSON.parse(readMedicalReleaseFile(path));
    if (
      !object(value) ||
      !keys(value, ["version", "owner", "entries"]) ||
      value.version !== 1 ||
      value.owner !== signature(this.key, "owner") ||
      !Array.isArray(value.entries) ||
      value.entries.length > LIMIT
    )
      throw new Error("Invalid fixture journal owner or format.");
    // Validate the entire import before changing in-memory provenance.
    const imported = new Map(this.records);
    for (const raw of value.entries) {
      if (
        !object(raw) ||
        !keys(raw, ["kind", "id", "label", "title", "complete", "signature"]) ||
        typeof raw.signature !== "string" ||
        !/^[a-f0-9]{64}$/.test(raw.signature)
      )
        throw new Error("Invalid fixture receipt format.");
      const entry = {
        kind: raw.kind,
        id: raw.id,
        label: raw.label,
        title: raw.title,
        complete: raw.complete,
      } as Entry;
      const sealed = seal(this.key, entry);
      if (!equal(raw.signature, sealed.signature))
        throw new Error("Invalid fixture receipt signature.");
      const id = entry.kind + ":" + entry.id;
      const prior = imported.get(id);
      if (prior && (prior.label !== entry.label || prior.title !== entry.title))
        throw new Error("Conflicting fixture provenance.");
      if (!prior || entry.complete) imported.set(id, entry);
    }
    if (imported.size > LIMIT)
      throw new Error("Fixture receipt capacity requires operator reconciliation.");
    this.records.clear();
    for (const [id, entry] of imported) this.records.set(id, entry);
  }
  add(kind: Kind, id: string, label: Label, title: string) {
    const entry = { kind, id, label, title, complete: false };
    requireEntry(this.key, entry);
    const recordKey = kind + ":" + id;
    const prior = this.records.get(recordKey);
    if (prior && (prior.label !== label || prior.title !== title))
      throw new Error("Conflicting fixture provenance.");
    if (!prior && !this.remaining)
      throw new Error("Fixture receipt capacity requires operator reconciliation.");
    this.records.set(recordKey, entry);
    this.save();
  }
  complete(kind: Kind, id: string) {
    const entry = this.records.get(kind + ":" + id);
    if (!entry) throw new Error("Unowned fixture cannot be completed.");
    this.records.set(kind + ":" + id, { ...entry, complete: true });
    this.save();
  }
  save() {
    const value = {
      version: 1,
      owner: signature(this.key, "owner"),
      entries: this.entries.map((entry) => seal(this.key, entry)),
    };
    const temporary = this.path + "." + randomUUID() + ".tmp";
    writeMedicalReleaseFile(temporary, value);
    try {
      renameSync(temporary, this.path);
    } finally {
      try {
        unlinkSync(temporary);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
}
