/** Owned medical fixture lifecycle; every cleanup failure keeps its signed receipt. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { medicalReleaseConfiguration } from "./medical-release-config";
import {
  requireMedicalRelease as check,
  medicalReleaseObject as object,
  MedicalReleaseAssertion,
  MedicalReleaseUpstreamFailure,
} from "./medical-release-evidence";
import { MedicalReleaseSession, MedicalReleaseDeadlineError } from "./medical-release-http";
import { MedicalReleaseJournal, ownedMedicalReleaseTitle } from "./medical-release-journal";

export const MEDICAL_RELEASE_ROOT = "/api/patients/me/medical-documents";
export type MedicalReleasePatient = "patient-a" | "patient-b";
type Session = Pick<MedicalReleaseSession, "request">;
type Environment = Parameters<typeof medicalReleaseConfiguration>[0];
type Options = {
  sessionFactory?: (target: "clinic" | "search") => Session;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

export class MedicalReleaseJourney {
  readonly configuration: ReturnType<typeof medicalReleaseConfiguration>;
  readonly journal: MedicalReleaseJournal;
  readonly doctor: Session;
  readonly patients: Record<MedicalReleasePatient, Session>;
  readonly backend: Session;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (message: string) => void;
  private authenticated = false;
  stage = "configuration";
  constructor(environment: Environment, options: Options = {}) {
    this.configuration = medicalReleaseConfiguration(environment);
    this.now = options.now || Date.now;
    this.sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.log = options.log || console.log;
    const factory = options.sessionFactory || ((target) => new MedicalReleaseSession(target));
    this.doctor = factory("clinic");
    this.patients = { "patient-a": factory("clinic"), "patient-b": factory("clinic") };
    this.backend = factory("search");
    mkdirSync(dirname(this.configuration.journalPath), { recursive: true, mode: 0o700 });
    this.journal = new MedicalReleaseJournal(
      this.configuration.journalPath,
      this.configuration.key,
    );
    // Prove the private journal can be persisted before login or upload.
    this.journal.save();
  }
  step(name: string) {
    this.stage = name;
    this.log("CHECK " + name);
  }
  patientId(label: MedicalReleasePatient) {
    return this.configuration.identity.accounts[label].profileId;
  }
  doctorPath(label: MedicalReleasePatient = "patient-a") {
    return "/api/doctors/me/patients/" + this.patientId(label);
  }
  threadPath(id?: string) {
    return this.doctorPath() + "/medical-chat/conversations" + (id ? "/" + id : "");
  }

  async health(session: Session, path: string, expected?: string) {
    for (let attempt = 0; attempt < 4; attempt++) {
      let status = 0,
        value: unknown = null;
      try {
        const response = await session.request("GET", path);
        status = response.status;
        value = response.value;
      } catch {
        /* Bounded read-only cold-start recovery. */
      }
      if (status === 200) {
        const data = object(value);
        check(data.status === (path.endsWith("ready") ? "ready" : "ok"), "Service is not ready.");
        if (expected)
          check(
            (data.gitCommit || data.git_commit) === expected,
            "Exact serving revision mismatch.",
          );
        if (path.endsWith("ready"))
          check(data.database === "connected", "Service database is not ready.");
        return;
      }
      check([0, 502, 503, 504].includes(status), "Unexpected service health status.");
      if (attempt < 3) {
        this.log("WAIT bounded service health recovery");
        await this.sleep(2000);
      }
    }
    throw new Error("Service did not recover within four read-only health attempts.");
  }
  async login() {
    this.step("exact deployed revisions and database readiness");
    await this.health(this.doctor, "/api/health", this.configuration.expectedSha);
    await this.health(this.doctor, "/api/health/ready");
    await this.health(this.backend, "/health", this.configuration.expectedSearchSha);
    await this.health(this.backend, "/ready", this.configuration.expectedSearchSha);
    this.step("owned synthetic logins and roles");
    for (const label of ["doctor", "patient-a", "patient-b"] as const) {
      const account = this.configuration.identity.accounts[label];
      const session = label === "doctor" ? this.doctor : this.patients[label];
      const response = await session.request("POST", "/api/user/login", {
        email: account.email,
        password: account.password,
      });
      check(response.status === 200, "Synthetic login failed.");
      const data = object(response.value),
        user = object(data.user);
      check(
        user.id === account.userId &&
          user.role === account.role &&
          data[label === "doctor" ? "doctorId" : "patientId"] === account.profileId,
        "Synthetic login ownership mismatch.",
      );
    }
    this.authenticated = true;
    check(
      (
        await this.doctor.request(
          "GET",
          "/api/doctors/" + this.configuration.identity.accounts.doctor.profileId,
        )
      ).status === 404,
      "Fixture doctor appears as a public practitioner.",
    );
  }
  async discover() {
    this.step("recover signed owned upload and thread provenance");
    for (const label of ["patient-a", "patient-b"] as const) {
      const response = await this.patients[label].request("GET", MEDICAL_RELEASE_ROOT);
      check(response.status === 200, "Owned fixture catalog unavailable.");
      const data = object(response.value);
      check(
        Array.isArray(data.documents) && data.documents.length <= 128,
        "Owned document catalog exceeded its bound.",
      );
      for (const raw of data.documents) {
        const row = object(raw),
          owned = ownedMedicalReleaseTitle(this.configuration.key, row.title);
        // Unknown content in a synthetic account must not receive model eligibility.
        check(
          owned === label && row.patientId === this.patientId(label) && typeof row.id === "string",
          "Unowned or cross-patient fixture catalog entry.",
        );
        this.journal.add("document", row.id, label, String(row.title));
      }
    }
    const response = await this.doctor.request("GET", this.threadPath());
    check(response.status === 200, "Owned thread catalog unavailable.");
    const data = object(response.value);
    check(
      Array.isArray(data.conversations) && data.conversations.length <= 128,
      "Owned thread catalog exceeded its bound.",
    );
    for (const raw of data.conversations) {
      const row = object(raw);
      check(
        ownedMedicalReleaseTitle(this.configuration.key, row.title) === "conversation-a" &&
          typeof row.id === "string",
        "Unowned fixture thread.",
      );
      this.journal.add("conversation", row.id, "conversation-a", String(row.title));
    }
  }
  async cleanup() {
    this.step("delete and verify scoped physical cleanup");
    let failures = 0;
    for (const entry of this.journal.entries.filter((row) => !row.complete)) {
      let cleanupStep = "delete",
        status = 0;
      try {
        const patient = entry.label === "patient-b" ? "patient-b" : "patient-a";
        const session = entry.kind === "document" ? this.patients[patient] : this.doctor;
        const path =
          entry.kind === "document"
            ? MEDICAL_RELEASE_ROOT + "/" + entry.id
            : this.threadPath(entry.id);
        let response = await session.request("DELETE", path);
        status = response.status;
        check(status === 200 || status === 404, "Fixture deletion unavailable.");
        cleanupStep = "metadata";
        status = 0;
        response = await session.request("GET", path);
        status = response.status;
        check(status === 404, "Deleted fixture metadata remains accessible.");
        if (entry.kind === "document") {
          const deadline = this.now() + 120000;
          while (true) {
            cleanupStep = "receipt";
            status = 0;
            response = await session.request("GET", path + "/cleanup");
            status = response.status;
            check(status === 200, "Scoped physical cleanup receipt unavailable.");
            const receipt = object(object(response.value).cleanup);
            check(
              receipt.documentId === entry.id &&
                ["pending", "complete"].includes(String(receipt.status)),
              "Invalid physical cleanup receipt identity/state.",
            );
            if (receipt.status === "complete") {
              check(
                receipt.vectorsRemaining === 0 &&
                  receipt.derivedObjectsRemaining === 0 &&
                  receipt.objectDeleted === true,
                "Physical vector or object cleanup incomplete.",
              );
              break;
            }
            check(this.now() < deadline, "Physical cleanup timed out.");
            await this.sleep(2000);
          }
          if (patient === "patient-a") {
            cleanupStep = "retrieval";
            status = 0;
            response = await this.doctor.request("POST", this.doctorPath() + "/medical-search", {
              query: entry.title,
            });
            status = response.status;
            const data = object(response.value);
            check(
              status === 200 &&
                Array.isArray(data.results) &&
                data.results.every((value) => object(value).documentId !== entry.id),
              "Deleted evidence remains retrievable.",
            );
          }
        }
        this.journal.complete(entry.kind, entry.id);
      } catch {
        failures++;
        this.log(
          `FAIL owned cleanup label=${entry.label} check=${cleanupStep} http=${status || "unknown"}`,
        );
      }
    }
    check(failures === 0, "Owned fixture cleanup failed.");
  }
  async run(exercise: (journey: MedicalReleaseJourney) => Promise<void>) {
    let primary = false,
      cleanupFailed = false;
    try {
      await this.login();
      await this.discover();
      await this.cleanup();
      check(
        this.journal.remaining >= 3,
        "Fixture receipt capacity requires reconciliation before upload.",
      );
      const previous = new Set(this.journal.entries.map((entry) => entry.kind + ":" + entry.id));
      await exercise(this);
      const created = this.journal.entries.filter(
        (entry) => !previous.has(entry.kind + ":" + entry.id),
      );
      check(
        created.filter((entry) => entry.kind === "document").length === 2 &&
          created.filter((entry) => entry.kind === "conversation").length === 1,
        "A fresh two-patient document and conversation journey is required.",
      );
    } catch (error) {
      primary = true;
      this.log("FAIL " + this.stage);
      if (error instanceof MedicalReleaseUpstreamFailure)
        this.log(`FAIL upstream http=${error.status || "unknown"} code=${error.code}`);
      else this.log("FAIL reason=" + (error instanceof MedicalReleaseAssertion ? error.code :
        error instanceof MedicalReleaseDeadlineError ? "transport_timeout" :
        error instanceof SyntaxError ? "invalid_response_json" : "transport_or_response_failure"));
    }
    if (this.authenticated) {
      try {
        await this.discover();
        await this.cleanup();
      } catch {
        cleanupFailed = true;
        this.log("FAIL cleanup verification");
      }
    }
    check(
      !primary &&
        !cleanupFailed &&
        this.journal.entries.length >= 3 &&
        this.journal.entries.every((entry) => entry.complete),
      "Authenticated medical release journey failed.",
    );
    this.log(
      "PASS authenticated medical upload/index/retrieval/answer/citations/SSE/isolation/physical cleanup",
    );
  }
}
