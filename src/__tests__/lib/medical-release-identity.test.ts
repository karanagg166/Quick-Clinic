import { describe, expect, it } from "vitest";
import { medicalReleaseIdentity, medicalReleaseTarget } from "@/lib/medical-release-identity";

const key = "public-synthetic-test-ownership-key-only";
describe("operator medical release ownership", () => {
  it("derives stable, distinct accounts and exactly bound grants with no real recipients", () => {
    const first = medicalReleaseIdentity(key);
    expect(medicalReleaseIdentity(key)).toEqual(first);
    expect(Object.keys(first.accounts)).toEqual(["doctor", "patient-a", "patient-b"]);
    const identifiers = [first.slotId, first.appointmentId];
    for (const account of Object.values(first.accounts)) {
      identifiers.push(account.userId, account.profileId);
      expect(account.email).toMatch(/^ss-release-[a-f0-9]{24}@example\.com$/);
      expect(account.password.length).toBeGreaterThanOrEqual(48);
    }
    expect(new Set(identifiers).size).toBe(8);
    expect(first.accounts.doctor.role).toBe("DOCTOR");
    expect(first.accounts["patient-b"].role).toBe("PATIENT");
    expect(new Date(first.pastStart).getTime()).toBeLessThan(new Date("2021-01-01").getTime());
  });

  it("does not share ownership or login material between operator keys", () => {
    const other = medicalReleaseIdentity(key + "-second");
    const original = medicalReleaseIdentity(key);
    expect(other.owner).not.toBe(original.owner);
    for (const label of ["doctor", "patient-a", "patient-b"] as const) {
      expect(other.accounts[label].userId).not.toBe(original.accounts[label].userId);
      expect(other.accounts[label].password).not.toBe(original.accounts[label].password);
    }
  });

  it.each(["", "short-key"])("rejects missing or weak ownership material", (value) => {
    expect(() => medicalReleaseIdentity(value)).toThrow("ownership key");
  });

  it("binds target host, database, role and schema while tolerating password rotation", () => {
    const first = medicalReleaseTarget("postgresql://synthetic:old@localhost/fixture?schema=public");
    expect(medicalReleaseTarget("postgresql://synthetic:new@localhost/fixture?schema=public")).toBe(first);
    for (const url of ["postgresql://synthetic:old@otherhost/fixture", "postgresql://synthetic:old@localhost/otherdb", "postgresql://otherrole:old@localhost/fixture", "postgresql://synthetic:old@localhost/fixture?schema=other"]) {
      expect(medicalReleaseTarget(url)).not.toBe(first);
    }
    expect(first).not.toContain("synthetic");
  });

  it.each(["https://example.com", "postgresql://localhost/fixture", "postgresql://synthetic:fake@localhost/"])("rejects an incomplete or non-database target", (value) => {
    expect(() => medicalReleaseTarget(value)).toThrow();
  });
});
