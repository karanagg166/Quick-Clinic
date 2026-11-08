/** Required synthetic identities and trusted release inputs; no implicit fallbacks. */
import { isDeepStrictEqual } from "node:util";
import { isAbsolute, join, resolve } from "node:path";
import { medicalReleaseIdentity } from "./medical-release-identity";
import { requireMedicalRelease } from "./medical-release-evidence";

export function medicalReleaseConfiguration(environment: Record<string, string | undefined>) {
  const key = environment.QC_RELEASE_FIXTURE_KEY || "";
  const identity = medicalReleaseIdentity(key);
  let credentials: unknown;
  try {
    credentials = JSON.parse(environment.QC_RELEASE_FIXTURE_CREDENTIALS || "");
  } catch {
    throw new Error("Protected synthetic login fixtures are required.");
  }
  requireMedicalRelease(
    isDeepStrictEqual(credentials, {
      version: 1,
      owner: identity.owner,
      accounts: identity.accounts,
    }),
    "Synthetic credential ownership mismatch.",
  );
  const expectedSha = environment.EXPECTED_SHA || "";
  const expectedSearchSha = environment.EXPECTED_SEARCH_SPHERE_SHA || "";
  requireMedicalRelease(
    /^[a-f0-9]{40}$/.test(expectedSha) && /^[a-f0-9]{40}$/.test(expectedSearchSha),
    "Exact deployed revisions are required.",
  );
  const journalPath = environment.QC_RELEASE_JOURNAL_PATH || "";
  requireMedicalRelease(isAbsolute(journalPath), "Explicit private cleanup journal path required.");
  if (environment.GITHUB_ACTIONS === "true") {
    requireMedicalRelease(
      environment.GITHUB_REPOSITORY?.toLowerCase() === "karanagg166/quick-clinic" &&
        environment.GITHUB_REF === "refs/heads/main" &&
        environment.GITHUB_EVENT_NAME === "workflow_dispatch",
      "Trusted main release event required.",
    );
    requireMedicalRelease(
      !!environment.GH_TOKEN &&
        /^[0-9]+$/.test(environment.GITHUB_RUN_ID || "") &&
        !!environment.RUNNER_TEMP &&
        isAbsolute(environment.RUNNER_TEMP),
      "Protected release identity and artifact access required.",
    );
    requireMedicalRelease(
      resolve(journalPath) === join(environment.RUNNER_TEMP, "qc-medical-release", "receipts.json"),
      "Private runner receipt path required.",
    );
  }
  return { key, identity, expectedSha, expectedSearchSha, journalPath };
}
