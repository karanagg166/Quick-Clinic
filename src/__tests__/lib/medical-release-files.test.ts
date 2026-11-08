import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  chmodSync,
  symlinkSync,
  statSync,
  mkdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMedicalReleaseFile, writeMedicalReleaseFile } from "@/lib/medical-release-files";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qc-private-files-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("private medical release operator files", () => {
  it("writes an exclusive owner-only output and reads it", () => {
    const file = join(dir, "plan.json");
    writeMedicalReleaseFile(file, { synthetic: true });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readMedicalReleaseFile(file))).toEqual({ synthetic: true });
  });
  it("never overwrites existing output", () => {
    const file = join(dir, "existing");
    writeFileSync(file, "original", { mode: 0o600 });
    expect(() => writeMedicalReleaseFile(file, { changed: true })).toThrow();
    expect(readFileSync(file, "utf8")).toBe("original");
  });
  it("refuses input and output symlinks", () => {
    const file = join(dir, "original");
    const link = join(dir, "link");
    writeFileSync(file, "original", { mode: 0o600 });
    symlinkSync(file, link);
    expect(() => readMedicalReleaseFile(link)).toThrow();
    expect(() => writeMedicalReleaseFile(link, {})).toThrow();
    expect(readFileSync(file, "utf8")).toBe("original");
  });
  it("refuses a non-private input", () => {
    const file = join(dir, "input");
    writeFileSync(file, "synthetic", { mode: 0o644 });
    expect(() => readMedicalReleaseFile(file)).toThrow("permissions");
  });
  it("refuses non-private and symlink output directories", () => {
    const parent = join(dir, "parent");
    mkdirSync(parent, { mode: 0o755 });
    expect(() => writeMedicalReleaseFile(join(parent, "output"), {})).toThrow();
    chmodSync(parent, 0o700);
    symlinkSync(parent, join(dir, "parent-link"));
    expect(() => writeMedicalReleaseFile(join(dir, "parent-link", "output"), {})).toThrow();
  });
  it.each(["", "x".repeat(65537)])("refuses an empty or oversized input", (content) => {
    const file = join(dir, "input");
    writeFileSync(file, content, { mode: 0o600 });
    expect(() => readMedicalReleaseFile(file)).toThrow("Invalid operator file");
  });
  it("refuses a FIFO without waiting for a writer", () => {
    const file = join(dir, "fifo");
    execFileSync("mkfifo", ["-m", "600", file]);
    expect(() => readMedicalReleaseFile(file)).toThrow("Invalid operator file");
  });
  it("requires absolute paths and rejects oversized output", () => {
    expect(() => readMedicalReleaseFile("relative")).toThrow("Absolute");
    expect(() => writeMedicalReleaseFile("relative", {})).toThrow("Absolute");
    expect(() => writeMedicalReleaseFile(join(dir, "large"), "x".repeat(65537))).toThrow(
      "Invalid operator output",
    );
  });
});
