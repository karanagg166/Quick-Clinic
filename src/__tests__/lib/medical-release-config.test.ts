import { describe, expect, it } from "vitest";
import { medicalReleaseConfiguration } from "@/lib/medical-release-config";
import { medicalReleaseIdentity } from "@/lib/medical-release-identity";
const key = "synthetic-ownership-key-for-config-verification-only";
const identity = medicalReleaseIdentity(key);
function environment() {
  return {
    QC_RELEASE_FIXTURE_KEY: key,
    QC_RELEASE_FIXTURE_CREDENTIALS: JSON.stringify({
      version: 1,
      owner: identity.owner,
      accounts: identity.accounts,
    }),
    EXPECTED_SHA: "a".repeat(40),
    EXPECTED_SEARCH_SPHERE_SHA: "b".repeat(40),
    QC_RELEASE_JOURNAL_PATH: "/tmp/qc-private/receipts.json",
  };
}
describe("required medical release inputs", () => {
  it("binds exact owned logins and both revisions without falling back to real accounts", () => {
    expect(medicalReleaseConfiguration(environment()).identity).toEqual(identity);
  });
  it.each([
    "QC_RELEASE_FIXTURE_KEY",
    "QC_RELEASE_FIXTURE_CREDENTIALS",
    "EXPECTED_SHA",
    "EXPECTED_SEARCH_SPHERE_SHA",
    "QC_RELEASE_JOURNAL_PATH",
  ])("fails closed when required input %s is missing", (field) => {
    expect(() => medicalReleaseConfiguration({ ...environment(), [field]: "" })).toThrow();
  });
  it("rejects a changed profile, credential owner, revision or relative journal path", () => {
    const value = JSON.parse(environment().QC_RELEASE_FIXTURE_CREDENTIALS);
    value.accounts.doctor.profileId = "foreign-profile";
    expect(() =>
      medicalReleaseConfiguration({
        ...environment(),
        QC_RELEASE_FIXTURE_CREDENTIALS: JSON.stringify(value),
      }),
    ).toThrow();
    expect(() =>
      medicalReleaseConfiguration({ ...environment(), EXPECTED_SHA: "short" }),
    ).toThrow();
    expect(() =>
      medicalReleaseConfiguration({ ...environment(), QC_RELEASE_JOURNAL_PATH: "relative.json" }),
    ).toThrow();
  });
  it("requires trusted main dispatch, artifact access and private runner receipts in Actions", () => {
    const actions = {
      ...environment(),
      GITHUB_ACTIONS: "true",
      GITHUB_REPOSITORY: "karanagg166/Quick-Clinic",
      GITHUB_REF: "refs/heads/main",
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_RUN_ID: "123",
      GH_TOKEN: "synthetic-read-token",
      RUNNER_TEMP: "/tmp/runner",
      QC_RELEASE_JOURNAL_PATH: "/tmp/runner/qc-medical-release/receipts.json",
    };
    expect(() => medicalReleaseConfiguration(actions)).not.toThrow();
    for (const changed of [
      { GITHUB_REF: "refs/heads/foreign" },
      { GITHUB_REPOSITORY: "foreign/repo" },
      { GITHUB_EVENT_NAME: "pull_request" },
      { GH_TOKEN: "" },
      { GITHUB_RUN_ID: "" },
      { QC_RELEASE_JOURNAL_PATH: "/tmp/foreign/receipts.json" },
    ]) {
      expect(() => medicalReleaseConfiguration({ ...actions, ...changed })).toThrow();
    }
  });
});
