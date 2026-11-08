/** Synthetic HTTP peer for release-controller failure tests; no network/provider calls. */
import { randomUUID } from "node:crypto";
import { medicalReleaseIdentity } from "@/lib/medical-release-identity";
import { MEDICAL_RELEASE_ROOT } from "@/lib/medical-release-journey";

export const medicalTestKey = "synthetic-medical-release-controller-test-ownership-key";
export const medicalTestIdentity = medicalReleaseIdentity(medicalTestKey);
type Account = keyof typeof medicalTestIdentity.accounts;
type Method = "GET" | "POST" | "DELETE";
type Doc = { id: string; patientId: string; title: string; marker: string; color: string };
type Thread = {
  id: string;
  doctorId: string;
  patientId: string;
  title: string;
  messages: Record<string, unknown>[];
};
const reply = (
  status: number,
  value: unknown,
  text = JSON.stringify(value),
  contentType = "application/json",
) => ({ status, value, text, contentType });
const cuid = () => "c" + randomUUID().replace(/-/g, "").slice(0, 24);

export class MedicalReleaseFake {
  fault = "";
  time = 0;
  readonly documents = new Map<string, Doc>();
  readonly deleted = new Map<string, Doc>();
  readonly threads = new Map<string, Thread>();
  readonly calls: { label: string; method: Method; path: string }[] = [];
  private sessions = 0;
  private healthFailures = 0;
  environment(path: string) {
    return {
      QC_RELEASE_FIXTURE_KEY: medicalTestKey,
      QC_RELEASE_FIXTURE_CREDENTIALS: JSON.stringify({
        version: 1,
        owner: medicalTestIdentity.owner,
        accounts: medicalTestIdentity.accounts,
      }),
      EXPECTED_SHA: "a".repeat(40),
      EXPECTED_SEARCH_SPHERE_SHA: "b".repeat(40),
      QC_RELEASE_JOURNAL_PATH: path,
    };
  }
  factory = (target: "clinic" | "search") => {
    const label =
      target === "search"
        ? "backend"
        : (["doctor", "patient-a", "patient-b"] as const)[this.sessions++ % 3];
    return {
      request: (method: Method, path: string, body?: unknown) =>
        this.request(label, method, path, body),
    };
  };
  addDocument(label: "patient-a" | "patient-b", title: string) {
    const value = {
      id: randomUUID(),
      patientId: medicalTestIdentity.accounts[label].profileId,
      title,
      marker: "PUBLIC_SYNTHETIC_ONLY",
      color: label === "patient-a" ? "teal" : "amber",
    };
    this.documents.set(value.id, value);
    return value;
  }
  private citation(doc: Doc) {
    return {
      citationId: 1,
      documentId: doc.id,
      pageNumber: 1,
      content: doc.marker + ". The verification color is " + doc.color + ".",
    };
  }
  private message(doc: Doc) {
    return {
      id: cuid(),
      role: "ASSISTANT",
      status: "COMPLETE",
      content: "The verification color is " + doc.color + ". [1]",
      citations: [this.citation(doc)],
    };
  }
  async request(label: string, method: Method, path: string, body?: unknown) {
    this.calls.push({ label, method, path });
    const account =
      label === "backend" ? undefined : medicalTestIdentity.accounts[label as Account];
    if (path === "/api/health")
      return reply(200, {
        status: "ok",
        gitCommit: (this.fault === "revision" ? "c" : "a").repeat(40),
      });
    if (path === "/health" && (this.fault === "health-unavailable" || this.fault === "cold-health" && this.healthFailures++ < 2)) return reply(503,{});
    if (path === "/health") return reply(200, { status: "ok", git_commit: "b".repeat(40) });
    if (path.endsWith("ready"))
      return reply(200, { status: "ready", database: "connected", git_commit: "b".repeat(40) });
    if (
      path === "/api/user/login" &&
      ((body as { email?: unknown })?.email !== account?.email ||
        (body as { password?: unknown })?.password !== account?.password)
    )
      return reply(401, {});
    if (path === "/api/user/login")
      return reply(200, {
        user: { id: account!.userId, role: account!.role },
        [label === "doctor" ? "doctorId" : "patientId"]: account!.profileId,
      });
    if (path === "/api/doctors/" + medicalTestIdentity.accounts.doctor.profileId)
      return reply(404, {});
    if (path === MEDICAL_RELEASE_ROOT && method === "GET")
      return reply(200, {
        documents: [...this.documents.values()].filter(
          (doc) => doc.patientId === account!.profileId,
        ),
      });
    if (path === MEDICAL_RELEASE_ROOT && method === "POST") {
      if (!(body instanceof FormData)) throw new Error("Synthetic multipart required.");
      const pdf = await (body.get("file") as Blob).text();
      const doc = this.addDocument(label as "patient-a" | "patient-b", String(body.get("title")));
      doc.marker = /Release marker ([A-Z0-9_]+)\./.exec(pdf)![1];
      if (this.fault === "lost-upload") throw new Error("synthetic lost upload response");
      return reply(201, { document: doc });
    }
    if (path.startsWith(MEDICAL_RELEASE_ROOT + "/")) {
      const suffix = path.slice(MEDICAL_RELEASE_ROOT.length + 1),
        id = suffix.split("/")[0];
      const doc = this.documents.get(id);
      if (suffix.endsWith("/cleanup")) {
        if (this.fault === "receipt-503" && this.deleted.get(id)?.color === "teal")
          return reply(503, { error: "SYNTHETIC_PRIVATE_ERROR" });
        if (!this.deleted.has(id)) return reply(404, {});
        return reply(200, {
          cleanup: {
            document_id: id,
            status: "complete",
            vectors_remaining: this.fault === "vectors-remain" ? 1 : 0,
            derived_objects_remaining: 0,
            object_deleted: true,
          },
        });
      }
      if (!doc || (doc.patientId !== account?.profileId && this.fault !== "patient-source-bypass"))
        return reply(404, {});
      if (suffix.endsWith("/processing-status"))
        return reply(200, {
          documentId: id,
          status:
            this.fault === "ingestion-failed"
              ? "FAILED"
              : this.fault === "ingestion-stuck"
                ? "QUEUED"
                : "READY",
          upstreamAvailable: true,
        });
      if (method === "DELETE") {
        if (this.fault === "delete-503" && doc.color === "teal")
          return reply(503, { error: "SYNTHETIC_PRIVATE_ERROR" });
        this.documents.delete(id);
        this.deleted.set(id, doc);
        return reply(200, { success: true });
      }
      return reply(200, { document: doc });
    }
    const a = medicalTestIdentity.accounts["patient-a"].profileId,
      b = medicalTestIdentity.accounts["patient-b"].profileId;
    if (path.startsWith("/api/doctors/me/patients/" + b) && this.fault !== "authorization-bypass")
      return reply(403, {});
    const current = [...this.documents.values()].find((doc) => doc.patientId === a);
    if (path.endsWith("/medical-search")) {
      const doc =
        this.fault === "foreign-source" && current
          ? [...this.documents.values()].find((doc) => doc.patientId === b)
          : current;
      return reply(200, {
        results: doc ? [{ patientId: doc.patientId, documentId: doc.id, content: doc.marker }] : [],
      });
    }
    if (path.endsWith("/medical-answer")) {
      if (this.fault === "answer-503") return reply(503, { error: "SYNTHETIC_PRIVATE_ERROR" });
      const message = this.message(current!);
      if (this.fault === "wrong-answer") message.content = "The color is amber. [1]";
      if (this.fault === "foreign-citation") message.citations[0].documentId = randomUUID();
      return reply(200, { answer: message.content, citations: message.citations });
    }
    const root = "/api/doctors/me/patients/" + a + "/medical-chat/conversations";
    if (path === root && method === "GET")
      return reply(200, { conversations: [...this.threads.values()] });
    if (path === root && method === "POST") {
      const thread = {
        id: cuid(),
        title: (body as { title: string }).title,
        doctorId: medicalTestIdentity.accounts.doctor.profileId,
        patientId: a,
        messages: [],
      };
      this.threads.set(thread.id, thread);
      if (this.fault === "lost-thread") throw new Error("synthetic lost thread response");
      return reply(201, { conversation: thread });
    }
    if (path.startsWith(root + "/")) {
      const id = path.slice(root.length + 1).split("/")[0],
        thread = this.threads.get(id);
      if (!thread) return reply(404, {});
      if (method === "DELETE") {
        this.threads.delete(id);
        return reply(200, { success: true });
      }
      if (path.endsWith("/messages") || path.endsWith("/stream")) {
        const message = this.message(current!);
        thread.messages.push(
          { id: cuid(), role: "USER", content: "Public synthetic question", status: "COMPLETE" },
          message,
        );
        if (path.endsWith("/messages"))
          return reply(200, { message, citations: message.citations });
        const event = (kind: string, value: unknown) =>
          "event: " + kind + "\ndata: " + JSON.stringify(value) + "\n\n";
        const text =
          event("start", { conversationId: id }) +
          event("token", { text: message.content }) +
          event("citations", { citations: message.citations }) +
          (this.fault === "sse-incomplete" ? "" : event("done", { messageId: message.id }));
        if (this.fault === "saved-turn-missing") thread.messages.pop();
        return reply(200, null, text, "text/event-stream");
      }
      return reply(200, { conversation: thread, messages: thread.messages });
    }
    throw new Error("Unexpected synthetic release route.");
  }
}
