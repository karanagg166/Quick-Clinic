import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  restoreMedicalReleaseReceipts,
  verifyMedicalReleaseAdmission,
  type MedicalReleaseCommand,
} from "@/lib/medical-release-restore";
import { MedicalReleaseJournal, medicalReleaseTitle } from "@/lib/medical-release-journal";
import { MedicalReleaseFake, medicalTestKey } from "@/__tests__/helpers/medical-release-fake";
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "qc-receipt-restore-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
function environment() {
  return {
    ...new MedicalReleaseFake().environment(join(dir, "qc-medical-release", "receipts.json")),
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "karanagg166/Quick-Clinic",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_RUN_ID: "124",
    GH_TOKEN: "synthetic-read-token",
    RUNNER_TEMP: dir,
  };
}
function source() {
  const path = join(dir, "source.json"),
    journal = new MedicalReleaseJournal(path, medicalTestKey);
  journal.add(
    "document",
    randomUUID(),
    "patient-a",
    medicalReleaseTitle(medicalTestKey, "a".repeat(32), "patient-a"),
  );
  return path;
}
describe("trusted medical release admission", () => {
  function command(failure = ""): MedicalReleaseCommand {
    return (program, args) => {
      if (program === "git") {
        if (failure === "history") throw new Error("synthetic ancestry denial");
        return "";
      }
      if (args[1].includes("/compare/"))
        return JSON.stringify({ status: failure === "backend-history" ? "diverged" : "ahead" });
      const name = args[1].includes("search-sphere/") ? "Search Sphere CI" : "CI";
      return JSON.stringify({
        workflow_runs:
          failure === "missing"
            ? []
            : [
                {
                  name,
                  status: failure === "pending" ? "in_progress" : "completed",
                  conclusion: failure === "failed" ? "failure" : "success",
                },
              ],
      });
    };
  }
  it("requires both exact serving main CIs and valid main history", () => {
    expect(() => verifyMedicalReleaseAdmission(environment(), command())).not.toThrow();
  });
  it.each(["history", "backend-history", "missing", "pending", "failed"])(
    "refuses invalid release admission: %s",
    (failure) => {
      expect(() => verifyMedicalReleaseAdmission(environment(), command(failure))).toThrow();
    },
  );
});
describe("signed provenance from trusted release artifacts", () => {
  function command(
    options: {
      missing?: boolean;
      expired?: boolean;
      oversized?: boolean;
      mutated?: boolean;
      untrusted?: boolean;
      step?: string;
      future?: boolean;
      active?: boolean;
    } = {},
  ): MedicalReleaseCommand {
    const original = source();
    return (program, args) => {
      expect(program).toBe("gh");
      if (args[0] === "run" && args[1] === "list")
        return JSON.stringify([
          ...(options.future
            ? [
                {
                  databaseId: 125,
                  event: "workflow_dispatch",
                  headBranch: "main",
                  status: "queued",
                },
              ]
            : []),
          { databaseId: 124, event: "workflow_dispatch", headBranch: "main" },
          {
            databaseId: 123,
            event: options.untrusted ? "pull_request" : "workflow_dispatch",
            headBranch: "main",
            status: options.active ? "in_progress" : "completed",
          },
        ]);
      if (args[0] === "run" && args[1] === "download") {
        const target = args[args.indexOf("--dir") + 1];
        copyFileSync(original, join(target, "receipts.json"));
        if (options.mutated)
          writeFileSync(
            join(target, "receipts.json"),
            '{"version":1,"owner":"foreign","entries":[]}',
          );
        return "";
      }
      if (args[1].includes("/artifacts?"))
        return JSON.stringify({
          total_count: options.missing ? 0 : 1,
          artifacts: options.missing
            ? []
            : [
                {
                  name: "medical-release-fixture-receipts-123",
                  expired: options.expired || false,
                  size_in_bytes: options.oversized ? 999999 : 1000,
                },
              ],
        });
      if (args[1].includes("/jobs?"))
        return JSON.stringify({
          total_count: 1,
          jobs: [
            {
              steps: [
                {
                  name: "Run authenticated synthetic medical journey",
                  conclusion: options.step || "failure",
                },
              ],
            },
          ],
        });
      throw new Error("Unexpected synthetic artifact command.");
    };
  }
  it("restores signed unresolved receipts from the exact prior trusted artifact", () => {
    const result = restoreMedicalReleaseReceipts(environment(), command());
    expect(result).toEqual({ restored: true, entries: 1 });
    expect(
      new MedicalReleaseJournal(environment().QC_RELEASE_JOURNAL_PATH, medicalTestKey).entries[0]
        .complete,
    ).toBe(false);
  });
  it("ignores a later queued release and restores the completed predecessor", () => {
    expect(restoreMedicalReleaseReceipts(environment(), command({ future: true }))).toEqual({
      restored: true,
      entries: 1,
    });
  });
  it("refuses to consume a still-active predecessor's incomplete provenance", () => {
    expect(() => restoreMedicalReleaseReceipts(environment(), command({ active: true }))).toThrow(
      "still active",
    );
  });
  it.each([
    { expired: true },
    { oversized: true },
    { mutated: true },
    { untrusted: true },
    { missing: true },
  ])("fails closed for unavailable, altered or untrusted provenance", (options) => {
    expect(() => restoreMedicalReleaseReceipts(environment(), command(options))).toThrow();
  });
  it("skips only a prior run whose mutating step was explicitly skipped", () => {
    expect(
      restoreMedicalReleaseReceipts(environment(), command({ missing: true, step: "skipped" })),
    ).toEqual({ restored: false, entries: 0 });
  });
  it("creates an initial signed journal only for a bounded empty trusted history", () => {
    const cmd: MedicalReleaseCommand = () =>
      JSON.stringify([{ databaseId: 124, event: "workflow_dispatch", headBranch: "main" }]);
    expect(restoreMedicalReleaseReceipts(environment(), cmd)).toEqual({
      restored: false,
      entries: 0,
    });
    expect(
      new MedicalReleaseJournal(environment().QC_RELEASE_JOURNAL_PATH, medicalTestKey).entries,
    ).toEqual([]);
  });
  it("requires artifact credentials before any command", () => {
    const cmd: MedicalReleaseCommand = () => {
      throw new Error("Command must not run.");
    };
    expect(() => restoreMedicalReleaseReceipts({ ...environment(), GH_TOKEN: "" }, cmd)).toThrow(
      "artifact",
    );
  });
});
