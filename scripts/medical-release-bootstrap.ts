/** Operator only. Read-only plan first; explicitly apply that private signed plan. */
import { parseArgs } from "node:util";
import { parse } from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import {
  planMedicalRelease,
  applyMedicalRelease,
  type MedicalReleasePlan,
} from "../src/lib/medical-release-bootstrap";
import { medicalReleaseIdentity } from "../src/lib/medical-release-identity";
import {
  readMedicalReleaseFile,
  writeMedicalReleaseFile,
  requireMedicalReleaseDestination,
} from "../src/lib/medical-release-files";

let stage = "arguments";
async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    strict: true,
    options: {
      "database-env-file": { type: "string" },
      "key-file": { type: "string" },
      "plan-file": { type: "string" },
      "credentials-file": { type: "string" },
    },
  });
  const mode = positionals[0];
  const databaseFile = values["database-env-file"];
  const keyFile = values["key-file"];
  const planFile = values["plan-file"];
  const credentialsFile = values["credentials-file"];
  if (
    positionals.length !== 1 ||
    !["plan", "apply"].includes(mode) ||
    !databaseFile ||
    !keyFile ||
    !planFile ||
    (mode === "plan" ? !!credentialsFile : !credentialsFile)
  ) {
    throw new Error("Explicit mode and private operator file paths required.");
  }
  // Parse one explicitly selected configuration, without loading application .env
  // or inheriting an accidental DATABASE_URL from a test/developer shell.
  stage = "private-files";
  const databaseUrl = parse(readMedicalReleaseFile(databaseFile)).DATABASE_URL;
  if (!databaseUrl) throw new Error("Explicit database configuration required.");
  const key = readMedicalReleaseFile(keyFile, 4096).trim();
  const identity = medicalReleaseIdentity(key);
  if (mode === "plan") requireMedicalReleaseDestination(planFile);
  else requireMedicalReleaseDestination(credentialsFile!);
  const plan =
    mode === "apply" ? (JSON.parse(readMedicalReleaseFile(planFile)) as MedicalReleasePlan) : null;
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: 2,
      connectionTimeoutMillis: 15000,
      idleTimeoutMillis: 10000,
    }),
    log: [],
  });
  try {
    if (mode === "plan") {
      stage = "read-only-plan";
      const proposed = await planMedicalRelease(db, databaseUrl, key);
      stage = "plan-output";
      writeMedicalReleaseFile(planFile, proposed);
      console.log(
        JSON.stringify({
          stage: "planned",
          owner: proposed.owner,
          target: proposed.target,
          mode: proposed.mode,
          expiresAt: proposed.expiresAt,
        }),
      );
    } else {
      stage = "atomic-apply";
      const result = await applyMedicalRelease(db, databaseUrl, key, plan!);
      stage = "credentials-output";
      writeMedicalReleaseFile(credentialsFile!, {
        version: 1,
        owner: identity.owner,
        accounts: identity.accounts,
      });
      console.log(JSON.stringify({ stage: "applied", owner: identity.owner, ...result }));
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch(() => {
  // Never print database/provider exceptions, paths, credentials or record values.
  console.error(
    JSON.stringify({
      stage,
      result: "failed",
      message: "No success asserted; verify private files, signed plan and target state.",
    }),
  );
  process.exitCode = 1;
});
