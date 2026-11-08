/** Three authenticated generation contracts use only owned public synthetic notes. */
import { randomUUID } from "node:crypto";
import type { MedicalReleaseJourney, MedicalReleasePatient } from "./medical-release-journey";
import { MEDICAL_RELEASE_ROOT } from "./medical-release-journey";
import { medicalReleaseTitle } from "./medical-release-journal";
import {
  requireMedicalRelease as check,
  medicalReleaseObject as object,
  medicalReleasePdf,
  verifyMedicalReleaseAnswer,
  parseMedicalReleaseStream,
  requireMedicalReleaseStatus,
} from "./medical-release-evidence";

export async function exerciseMedicalRelease(journey: MedicalReleaseJourney) {
  const run = randomUUID().replace(/-/g, "");
  const ids: Record<MedicalReleasePatient, string> = { "patient-a": "", "patient-b": "" };
  const markers = {
    "patient-a": "QC_MEDICAL_A_" + run.toUpperCase(),
    "patient-b": "QC_MEDICAL_B_" + run.toUpperCase(),
  };
  journey.step("upload new synthetic patient PDFs and poll actual upstream states");
  for (const label of ["patient-a", "patient-b"] as const) {
    const title = medicalReleaseTitle(journey.configuration.key, run, label);
    const data = new FormData();
    data.set("title", title);
    data.set("type", "OTHER");
    data.set("reportDate", "2020-01-15");
    data.set("idempotencyKey", title);
    const pdf = medicalReleasePdf(markers[label], label === "patient-a" ? "teal" : "amber");
    data.set(
      "file",
      new Blob([new Uint8Array(pdf).buffer], { type: "application/pdf" }),
      title + ".pdf",
    );
    const response = await journey.patients[label].request("POST", MEDICAL_RELEASE_ROOT, data);
    check(response.status === 201, "Fresh synthetic upload failed.");
    const document = object(object(response.value).document);
    check(
      typeof document.id === "string" &&
        document.title === title &&
        document.patientId === journey.patientId(label),
      "Upload identity/scope mismatch.",
    );
    ids[label] = document.id;
    journey.journal.add("document", document.id, label, title);
    const deadline = journey.now() + 180000;
    while (true) {
      const state = await journey.patients[label].request(
        "GET",
        MEDICAL_RELEASE_ROOT + "/" + document.id + "/processing-status",
      );
      check(state.status === 200, "Upstream processing state unavailable.");
      const value = object(state.value);
      check(
        value.documentId === document.id &&
          value.upstreamAvailable === true &&
          ["PENDING", "QUEUED", "PROCESSING", "READY", "FAILED"].includes(String(value.status)),
        "Invalid processing state contract.",
      );
      check(value.status !== "FAILED", "Ingestion reached terminal failure.");
      if (value.status === "READY") break;
      check(journey.now() < deadline, "Uploaded fixture did not index within its bound.");
      await journey.sleep(2000);
    }
  }
  journey.step("authorized unique-marker retrieval and patient isolation");
  const search = await journey.doctor.request("POST", journey.doctorPath() + "/medical-search", {
    query: markers["patient-a"],
    limit: 5,
  });
  check(search.status === 200, "Authorized marker retrieval failed.");
  const found = object(search.value);
  check(
    Array.isArray(found.results) &&
      found.results.some((raw) => {
        const value = object(raw);
        return (
          value.documentId === ids["patient-a"] &&
          typeof value.content === "string" &&
          value.content.includes(markers["patient-a"])
        );
      }),
    "Unique marker not retrieved from the new document.",
  );
  for (const raw of found.results) {
    const value = object(raw);
    check(
      value.patientId === journey.patientId("patient-a") &&
        value.documentId !== ids["patient-b"] &&
        !String(value.content).includes(markers["patient-b"]),
      "Foreign patient evidence returned.",
    );
  }
  const foreignQuery = await journey.doctor.request(
    "POST",
    journey.doctorPath() + "/medical-search",
    { query: markers["patient-b"], limit: 5 },
  );
  check(foreignQuery.status === 200, "Authorized scope-isolation retrieval unavailable.");
  const foreign = object(foreignQuery.value);
  check(
    Array.isArray(foreign.results) &&
      foreign.results.every((raw) => {
        const value = object(raw);
        return (
          value.patientId === journey.patientId("patient-a") &&
          value.documentId !== ids["patient-b"] &&
          !String(value.content).includes(markers["patient-b"])
        );
      }),
    "Another patient's evidence escaped its scope.",
  );
  for (const route of ["medical-search", "medical-answer"]) {
    check(
      (
        await journey.doctor.request("POST", journey.doctorPath("patient-b") + "/" + route, {
          query: markers["patient-b"],
        })
      ).status === 403,
      "Doctor accessed an ungranted patient.",
    );
  }
  check(
    (
      await journey.patients["patient-a"].request(
        "GET",
        MEDICAL_RELEASE_ROOT + "/" + ids["patient-b"],
      )
    ).status === 404,
    "Patient accessed another patient's source.",
  );

  journey.step("expected grounded legacy answer and supporting page citations");
  const question =
    "According to the uploaded note with release marker " +
    markers["patient-a"] +
    ", what is its verification color?";
  const answer = await journey.doctor.request(
    "POST",
    journey.doctorPath() + "/medical-answer",
    { query: question, limit: 5 },
    65000,
  );
  requireMedicalReleaseStatus(answer, 200, "Grounded medical answer failed.");
  const answered = object(answer.value);
  verifyMedicalReleaseAnswer(
    answered.answer,
    answered.citations,
    ids["patient-a"],
    markers["patient-a"],
    "teal",
  );

  journey.step("create owned medical conversation");
  const title = medicalReleaseTitle(journey.configuration.key, run, "conversation-a");
  const created = await journey.doctor.request("POST", journey.threadPath(), { title });
  check(created.status === 201, "Owned medical thread creation failed.");
  const thread = object(object(created.value).conversation);
  check(
    typeof thread.id === "string" &&
      thread.title === title &&
      thread.doctorId === journey.configuration.identity.accounts.doctor.profileId &&
      thread.patientId === journey.patientId("patient-a"),
    "Medical thread identity/scope mismatch.",
  );
  journey.journal.add("conversation", thread.id, "conversation-a", title);
  journey.step("owned conversation JSON answer and page citations");
  const conversation = await journey.doctor.request(
    "POST",
    journey.threadPath(thread.id) + "/messages",
    { message: question, clientMessageId: randomUUID(), limit: 5 },
    65000,
  );
  requireMedicalReleaseStatus(conversation, 200, "Conversation JSON answer failed.");
  const message = object(object(conversation.value).message);
  verifyMedicalReleaseAnswer(
    message.content,
    message.citations,
    ids["patient-a"],
    markers["patient-a"],
    "teal",
  );
  journey.step("contextual SSE response and completion frames");
  const streamed = await journey.doctor.request(
    "POST",
    journey.threadPath(thread.id) + "/stream",
    {
      message: "What verification color did that note assign?",
      clientMessageId: randomUUID(),
      limit: 5,
    },
    65000,
  );
  requireMedicalReleaseStatus(streamed, 200, "Medical SSE response unavailable.");
  check(
    streamed.contentType.includes("text/event-stream"),
    "Medical SSE response unavailable.",
  );
  const complete = parseMedicalReleaseStream(streamed.text, thread.id);
  journey.step("expected grounded SSE answer and page citations");
  verifyMedicalReleaseAnswer(
    complete.answer,
    complete.citations,
    ids["patient-a"],
    markers["patient-a"],
    "teal",
  );

  journey.step("persisted complete turns and valid source references");
  const history = await journey.doctor.request("GET", journey.threadPath(thread.id));
  check(history.status === 200, "Saved conversation unavailable.");
  const saved = object(history.value);
  check(
    Array.isArray(saved.messages) && saved.messages.length === 4,
    "Completed conversation turns were not persisted.",
  );
  const assistants = saved.messages.map(object).filter((row) => row.role === "ASSISTANT");
  check(
    assistants.length === 2 && assistants.some((row) => row.id === complete.messageId),
    "Completed SSE assistant message missing.",
  );
  for (const row of assistants) {
    check(row.status === "COMPLETE", "Incomplete assistant turn persisted.");
    verifyMedicalReleaseAnswer(
      row.content,
      row.citations,
      ids["patient-a"],
      markers["patient-a"],
      "teal",
    );
  }
}
