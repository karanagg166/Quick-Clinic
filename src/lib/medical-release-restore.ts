/** Trusted main-only release admission and signed artifact recovery; no application data. */
import { execFileSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { medicalReleaseConfiguration } from "./medical-release-config";
import { MedicalReleaseJournal } from "./medical-release-journal";
import {
  requireMedicalRelease as check,
  medicalReleaseObject as object,
} from "./medical-release-evidence";

const REPO = "karanagg166/Quick-Clinic",
  WORKFLOW = "medical-release-journey.yml",
  STEP = "Run authenticated synthetic medical journey";
type Environment = Parameters<typeof medicalReleaseConfiguration>[0];
export type MedicalReleaseCommand = (program: "gh" | "git", args: string[]) => string;
const execute: MedicalReleaseCommand = (program, args) =>
  execFileSync(program, args, { encoding: "utf8", timeout: 45000, maxBuffer: 1048576 });
const api = (command: MedicalReleaseCommand, path: string) =>
  object(JSON.parse(command("gh", ["api", path])));

export function verifyMedicalReleaseAdmission(
  environment: Environment,
  command: MedicalReleaseCommand = execute,
) {
  const configuration = medicalReleaseConfiguration(environment);
  check(!!environment.GH_TOKEN, "Read access to release CI metadata is required.");
  command("git", ["merge-base", "--is-ancestor", configuration.expectedSha, "HEAD"]);
  const comparison = api(
    command,
    "repos/karanagg166/search-sphere/compare/" + configuration.expectedSearchSha + "...main",
  );
  check(
    ["ahead", "identical"].includes(String(comparison.status)),
    "Serving backend revision must belong to main history.",
  );
  for (const [repo, sha, name] of [
    [REPO, configuration.expectedSha, "CI"],
    ["karanagg166/search-sphere", configuration.expectedSearchSha, "Search Sphere CI"],
  ]) {
    const value = api(
      command,
      "repos/" + repo + "/actions/runs?head_sha=" + sha + "&event=push&branch=main&per_page=100",
    );
    check(Array.isArray(value.workflow_runs), "Exact revision CI metadata unavailable.");
    const runs = value.workflow_runs.map(object).filter((run) => run.name === name);
    check(
      runs.length > 0 && runs[0].status === "completed" && runs[0].conclusion === "success",
      "Exact serving main revision requires successful pre-deploy CI.",
    );
  }
}

export function restoreMedicalReleaseReceipts(
  environment: Environment,
  command: MedicalReleaseCommand = execute,
) {
  const configuration = medicalReleaseConfiguration(environment);
  const current = environment.GITHUB_RUN_ID || "";
  check(
    !!environment.GH_TOKEN && /^[0-9]+$/.test(current),
    "Trusted run identity and artifact read access are required.",
  );
  mkdirSync(dirname(configuration.journalPath), { recursive: true, mode: 0o700 });
  const journal = new MedicalReleaseJournal(configuration.journalPath, configuration.key);
  const runs: unknown = JSON.parse(
    command("gh", [
      "run",
      "list",
      "--repo",
      REPO,
      "--workflow",
      WORKFLOW,
      "--branch",
      "main",
      "--limit",
      "20",
      "--json",
      "databaseId,event,headBranch,status",
    ]),
  );
  check(Array.isArray(runs), "Invalid trusted release history.");
  for (const value of runs) {
    const run = object(value),
      id = String(run.databaseId);
    check(
      /^[0-9]+$/.test(id) && run.event === "workflow_dispatch" && run.headBranch === "main",
      "Untrusted cleanup receipt history.",
    );
    if (id === current) continue;
    if (
      BigInt(id) > BigInt(current) &&
      ["queued", "waiting", "pending", "requested"].includes(String(run.status))
    )
      continue;
    check(
      run.status === "completed",
      "Prior release is still active; wait for its signed cleanup provenance.",
    );
    const name = "medical-release-fixture-receipts-" + id;
    const metadata = api(
      command,
      "repos/" + REPO + "/actions/runs/" + id + "/artifacts?per_page=100",
    );
    check(
      Number.isSafeInteger(metadata.total_count) &&
        Number(metadata.total_count) < 100 &&
        Array.isArray(metadata.artifacts),
      "Receipt lookup exceeds its bound.",
    );
    const artifacts = metadata.artifacts.map(object).filter((artifact) => artifact.name === name);
    if (artifacts.length) {
      check(
        artifacts.length === 1 &&
          artifacts[0].expired === false &&
          Number.isSafeInteger(artifacts[0].size_in_bytes) &&
          Number(artifacts[0].size_in_bytes) > 0 &&
          Number(artifacts[0].size_in_bytes) <= 131072,
        "Prior receipt artifact is unavailable or oversized; operator reconciliation required.",
      );
      const temporary = mkdtempSync(join(tmpdir(), "qc-trusted-receipts-"));
      try {
        command("gh", ["run", "download", id, "--repo", REPO, "--name", name, "--dir", temporary]);
        const path = join(temporary, "receipts.json"),
          stat = lstatSync(path);
        check(
          stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536,
          "Unsafe signed receipt artifact.",
        );
        chmodSync(path, 0o600);
        journal.importPath(path);
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
      journal.save();
      return { restored: true, entries: journal.entries.length };
    }
    const jobs = api(command, "repos/" + REPO + "/actions/runs/" + id + "/jobs?per_page=100");
    check(
      Number.isSafeInteger(jobs.total_count) &&
        Number(jobs.total_count) < 100 &&
        Array.isArray(jobs.jobs),
      "Prior mutating-step provenance unavailable or exceeds its bound.",
    );
    const steps = jobs.jobs
      .map(object)
      .flatMap((job) => (Array.isArray(job.steps) ? job.steps.map(object) : []))
      .filter((step) => step.name === STEP);
    check(
      steps.length > 0 && steps.every((step) => step.conclusion === "skipped"),
      "Missing prior cleanup provenance; operator reconciliation required.",
    );
  }
  check(runs.length < 20, "Receipt history exceeds its recovery bound.");
  journal.save();
  return { restored: false, entries: journal.entries.length };
}
