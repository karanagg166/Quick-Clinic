import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/prisma";
import { medicalReleaseIdentity } from "@/lib/medical-release-identity";

const key = randomBytes(48).toString("hex");
const identity = medicalReleaseIdentity(key);
const databaseUrl = process.env.DATABASE_URL || "";
let dir: string;
function run(mode: string, extra: string[] = []) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "scripts/medical-release-bootstrap.ts",
      mode,
      "--database-env-file",
      join(dir, "database.env"),
      "--key-file",
      join(dir, "key"),
      "--plan-file",
      join(dir, "plan.json"),
      ...extra,
    ],
    {
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://invalid:synthetic@127.0.0.1:1/wrong_database",
      },
    },
  );
}
beforeAll(async () => {
  const url = new URL(databaseUrl);
  expect(["localhost", "127.0.0.1", "host.docker.internal", "postgres"]).toContain(url.hostname);
  expect(url.pathname).toMatch(/\/(?:quick_clinic_test|quickclinic_test|test_db)$/);
  dir = mkdtempSync(join(tmpdir(), "qc-release-cli-"));
  writeFileSync(join(dir, "database.env"), "DATABASE_URL=" + JSON.stringify(databaseUrl), {
    mode: 0o600,
  });
  writeFileSync(join(dir, "key"), key, { mode: 0o600 });
  await prisma.location.upsert({
    where: { pincode: 121004 },
    update: {},
    create: { pincode: 121004, city: "Synthetic test location", state: "Test" },
  });
});
afterAll(async () => {
  await prisma.appointment.deleteMany({ where: { id: identity.appointmentId } });
  await prisma.slot.deleteMany({ where: { id: identity.slotId } });
  await prisma.user.deleteMany({
    where: { id: { in: Object.values(identity.accounts).map((account) => account.userId) } },
  });
  if (dir) rmSync(dir, { recursive: true, force: true });
});
describe("private medical release CLI", () => {
  it("requires an explicit read-only plan, applies it and recovers without overwriting credentials", async () => {
    const plan = run("plan");
    expect(plan.status).toBe(0);
    expect(JSON.parse(plan.stdout).stage).toBe("planned");
    expect(await prisma.user.count({ where: { id: identity.accounts.doctor.userId } })).toBe(0);
    const credentials = join(dir, "credentials.json");
    const apply = run("apply", ["--credentials-file", credentials]);
    expect(apply.status).toBe(0);
    expect(JSON.parse(apply.stdout)).toMatchObject({
      stage: "applied",
      created: true,
      ownedRecords: 8,
    });
    expect(statSync(credentials).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(credentials, "utf8"))).toEqual({
      version: 1,
      owner: identity.owner,
      accounts: identity.accounts,
    });
    const duplicate = run("apply", ["--credentials-file", credentials]);
    expect(duplicate.status).toBe(1);
    expect(JSON.parse(duplicate.stderr).stage).toBe("private-files");
    const recovered = run("apply", ["--credentials-file", join(dir, "recovered.json")]);
    expect(recovered.status).toBe(0);
    expect(JSON.parse(recovered.stdout).created).toBe(false);
    for (const result of [plan, apply, duplicate, recovered]) {
      const output = result.stdout + result.stderr;
      expect(output).not.toContain(databaseUrl);
      expect(output).not.toContain(key);
      for (const account of Object.values(identity.accounts)) {
        expect(output).not.toContain(account.email);
        expect(output).not.toContain(account.password);
      }
    }
  });
  it("fails safely on missing or unknown arguments without logging their values", () => {
    const missing = run("apply");
    expect(missing.status).toBe(1);
    expect(JSON.parse(missing.stderr).stage).toBe("arguments");
    const unknown = run("plan", ["--unrecognized", "synthetic-sensitive-argument"]);
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).not.toContain("synthetic-sensitive-argument");
  });
});
