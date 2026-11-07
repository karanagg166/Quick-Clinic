/** Operator-only ownership contract for synthetic medical release identities. */
import { createHash, createHmac } from "node:crypto";

export const MEDICAL_RELEASE_VERSION = 1;
export const MEDICAL_RELEASE_LABELS = ["doctor", "patient-a", "patient-b"] as const;
export type MedicalReleaseLabel = typeof MEDICAL_RELEASE_LABELS[number];

export function medicalReleaseIdentity(key: string) {
  if (typeof key !== "string" || Buffer.byteLength(key) < 32) throw new Error("A private release ownership key is required.");
  const digest = (label: string) => createHmac("sha256", key).update("quick-clinic-medical-release-v1:" + label).digest("hex");
  const id = (label: string) => {
    const value = digest(label).slice(0, 32);
    return `${value.slice(0,8)}-${value.slice(8,12)}-${value.slice(12,16)}-${value.slice(16,20)}-${value.slice(20)}`;
  };
  const accounts = Object.fromEntries(MEDICAL_RELEASE_LABELS.map((label) => [label, {
    userId: id("user-" + label), profileId: id("profile-" + label),
    email: `ss-release-${digest("email-" + label).slice(0,24)}@example.com`,
    password: digest("password-" + label).slice(0,48) + "!Aa7",
    role: label === "doctor" ? "DOCTOR" as const : "PATIENT" as const,
  }])) as Record<MedicalReleaseLabel, { userId: string; profileId: string; email: string; password: string; role: "DOCTOR" | "PATIENT" }>;
  return {
    version: MEDICAL_RELEASE_VERSION,
    owner: digest("owner"), accounts,
    slotId: id("past-slot"), appointmentId: id("past-appointment"),
    pastStart: "2020-01-15T10:00:00.000Z", pastEnd: "2020-01-15T10:30:00.000Z",
  };
}

/** Bind a private plan to one database endpoint, principal and schema without saving credentials. */
export function medicalReleaseTarget(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.pathname.slice(1) || !url.username) {
    throw new Error("An explicit PostgreSQL target is required.");
  }
  return createHash("sha256").update(JSON.stringify([
    url.hostname, url.port || "5432", url.pathname, url.username, url.searchParams.get("schema") || "public",
  ])).digest("hex");
}
