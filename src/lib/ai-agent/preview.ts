import {
  AgentApprovalRequest,
  AgentMessage,
  AgentRole,
  AgentStarterPrompt,
  AgentThread,
  ApprovalStatus,
} from "./types";

const STORAGE_PREFIX = "qc_ai_agent_threads_v1";
const APPROVAL_TTL_MS = 15 * 60 * 1000;

export const PATIENT_STARTER_PROMPTS: AgentStarterPrompt[] = [
  {
    id: "patient-availability",
    title: "Check doctor availability",
    prompt: "Check available consultation slots for a cardiologist this week.",
    actionType: "CHECK_AVAILABILITY",
    riskLevel: "LOW_AUTONOMOUS",
    description: "Read-only schedule lookup with zero side effects.",
  },
  {
    id: "patient-propose",
    title: "Propose & hold an appointment",
    prompt: "Propose and hold a morning appointment slot with Dr. Sharma tomorrow.",
    actionType: "PROPOSE_APPOINTMENT",
    riskLevel: "MEDIUM_HUMAN_APPROVAL",
    description: "Places a 10-minute hold after your explicit approval.",
  },
  {
    id: "patient-documents",
    title: "Review medical documents",
    prompt: "List my uploaded medical documents and lab report metadata.",
    actionType: "ACCESS_MEDICAL_DOCUMENTS",
    riskLevel: "HIGH_CLINICAL_RESTRICTED",
    description: "Metadata-only clinical access gated by record ownership.",
  },
  {
    id: "patient-cancel",
    title: "Cancel an upcoming visit",
    prompt: "Help me cancel my upcoming follow-up appointment with a refund check.",
    actionType: "CANCEL_APPOINTMENT",
    riskLevel: "MEDIUM_HUMAN_APPROVAL",
    description: "Requires human sign-off before cancelling and refunding.",
  },
];

export const DOCTOR_STARTER_PROMPTS: AgentStarterPrompt[] = [
  {
    id: "doctor-schedule",
    title: "Inspect today's open slots",
    prompt: "Check my remaining available consultation slots for today.",
    actionType: "CHECK_AVAILABILITY",
    riskLevel: "LOW_AUTONOMOUS",
    description: "Read-only inspection of your current slot availability.",
  },
  {
    id: "doctor-visit-summary",
    title: "Summarize visit history",
    prompt: "Summarize upcoming patient visit context and appointment status.",
    actionType: "SUMMARIZE_VISIT_HISTORY",
    riskLevel: "HIGH_CLINICAL_RESTRICTED",
    description: "Restricted to patients with an eligible appointment.",
  },
  {
    id: "doctor-documents",
    title: "Check authorized patient records",
    prompt: "Check medical document metadata for my confirmed patient appointment.",
    actionType: "ACCESS_MEDICAL_DOCUMENTS",
    riskLevel: "HIGH_CLINICAL_RESTRICTED",
    description: "Requires active appointment relationship verification.",
  },
  {
    id: "doctor-reschedule",
    title: "Propose slot reschedule",
    prompt: "Propose rescheduling my 4:00 PM consultation to tomorrow morning.",
    actionType: "RESCHEDULE_APPOINTMENT",
    riskLevel: "MEDIUM_HUMAN_APPROVAL",
    description: "Pauses for human confirmation before modifying appointments.",
  },
];

export function getStarterPromptsForRole(role: AgentRole): AgentStarterPrompt[] {
  return role === "DOCTOR" ? DOCTOR_STARTER_PROMPTS : PATIENT_STARTER_PROMPTS;
}

function getStorageKey(role: AgentRole, userId?: string | null): string {
  return `${STORAGE_PREFIX}:${role}:${userId || "anon"}`;
}

export function loadPreviewThreads(role: AgentRole, userId?: string | null): AgentThread[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(role, userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePreviewThreads(
  role: AgentRole,
  threads: AgentThread[],
  userId?: string | null
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(getStorageKey(role, userId), JSON.stringify(threads));
  } catch {
    // Ignore storage quota errors in preview mode
  }
}

function createId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPreviewAgentReply(
  role: AgentRole,
  prompt: string,
  idempotencyKey: string
): AgentMessage {
  const lower = prompt.toLowerCase();
  const now = new Date();
  const nowIso = now.toISOString();
  const expiresIso = new Date(now.getTime() + APPROVAL_TTL_MS).toISOString();

  const wantsCancel = /\bcancel\b|\brefund\b/.test(lower);
  const wantsReschedule = /\breschedule\b|\bmove\b|\bpostpone\b/.test(lower);
  const wantsBook = /\bbook\b|\bpropose\b|\bhold\b|\breserve\b|\bschedule an?\b/.test(lower);
  const wantsDocuments = /\bdocument\b|\breport\b|\brecord\b|\blab\b|\bprescription\b/.test(lower);
  const wantsVisitSummary = /\bsummarize\b|\bhistory\b|\bvisit\b/.test(lower);

  if (wantsCancel) {
    const approval: AgentApprovalRequest = {
      approvalId: createId("appr"),
      actionType: "CANCEL_APPOINTMENT",
      riskLevel: "MEDIUM_HUMAN_APPROVAL",
      status: "PENDING",
      title: "Approve Appointment Cancellation",
      summary:
        role === "DOCTOR"
          ? "Cancel selected consultation and trigger eligible refund workflow."
          : "Cancel upcoming appointment and initiate automatic refund if eligible.",
      reason: prompt.slice(0, 180),
      parameters: {
        action: "CANCEL_APPOINTMENT",
        refundPolicy: "Canonical booking cancellation engine",
        scope: role === "DOCTOR" ? "Doctor-initiated cancellation" : "Patient-initiated cancellation",
      },
      idempotencyKey,
      expiresAt: expiresIso,
    };

    return {
      id: createId("msg"),
      role: "assistant",
      createdAt: nowIso,
      status: "sent",
      content:
        "I prepared a cancellation request via the canonical booking workflow, which pauses for your explicit sign-off before any appointment state or refund changes occur. Review the approval card below to proceed or reject.",
      toolActivities: [
        {
          id: createId("tool"),
          toolName: "AppointmentActionToolInterface.cancel_appointment_with_reason",
          actionType: "CANCEL_APPOINTMENT",
          riskLevel: "MEDIUM_HUMAN_APPROVAL",
          status: "awaiting_approval",
          summary: "Graph interrupted — awaiting human approval before executing cancellation.",
          startedAt: nowIso,
          metadata: {
            requiresApproval: true,
            ttlMinutes: 15,
          },
        },
      ],
      approvalRequest: approval,
      citations: [
        {
          label: role === "DOCTOR" ? "All Appointments" : "My Appointments",
          href: role === "DOCTOR" ? "/doctor/appointments" : "/patient/appointments",
          type: "appointment",
        },
      ],
    };
  }

  if (wantsBook || wantsReschedule) {
    const actionType = wantsReschedule ? "RESCHEDULE_APPOINTMENT" : "PROPOSE_APPOINTMENT";
    const approval: AgentApprovalRequest = {
      approvalId: createId("appr"),
      actionType,
      riskLevel: "MEDIUM_HUMAN_APPROVAL",
      status: "PENDING",
      title: wantsReschedule ? "Approve Slot Reschedule" : "Approve 10-Minute Slot Hold",
      summary: wantsReschedule
        ? "Hold the proposed new slot and await confirmation to update the appointment."
        : "Acquire a temporary 10-minute slot hold using the canonical booking engine.",
      reason: prompt.slice(0, 180),
      parameters: {
        holdDurationMinutes: 10,
        paymentInitiated: false,
        bookingPath: "acquire_hold (preview)",
      },
      idempotencyKey,
      expiresAt: expiresIso,
    };

    return {
      id: createId("msg"),
      role: "assistant",
      createdAt: nowIso,
      status: "sent",
      content:
        "I checked scheduling constraints and staged a slot action. Because reserving or modifying appointments mutates clinic state, execution is paused until you approve or reject this request.",
      toolActivities: [
        {
          id: createId("tool"),
          toolName: "DoctorSchedulingToolInterface.get_available_slots",
          actionType: "CHECK_AVAILABILITY",
          riskLevel: "LOW_AUTONOMOUS",
          status: "completed",
          summary: "Read-only availability check completed without mutating slots.",
          startedAt: nowIso,
          completedAt: nowIso,
          metadata: { readOnly: true },
        },
        {
          id: createId("tool"),
          toolName: "AppointmentActionToolInterface.reserve_slot",
          actionType,
          riskLevel: "MEDIUM_HUMAN_APPROVAL",
          status: "awaiting_approval",
          summary: "Paused at LangGraph interrupt pending human confirmation.",
          startedAt: nowIso,
          metadata: { requiresApproval: true },
        },
      ],
      approvalRequest: approval,
      citations: [
        {
          label: role === "DOCTOR" ? "My Schedule" : "Find Doctors",
          href: role === "DOCTOR" ? "/doctor/schedule" : "/patient/findDoctors",
          type: "schedule",
        },
      ],
    };
  }

  if (wantsDocuments || wantsVisitSummary) {
    const actionType = wantsDocuments ? "ACCESS_MEDICAL_DOCUMENTS" : "SUMMARIZE_VISIT_HISTORY";
    const approval: AgentApprovalRequest | undefined =
      role === "DOCTOR" && wantsDocuments
        ? {
            approvalId: createId("appr"),
            actionType: "ACCESS_MEDICAL_DOCUMENTS",
            riskLevel: "HIGH_CLINICAL_RESTRICTED",
            status: "PENDING",
            title: "Verify Clinical Document Access",
            summary:
              "Confirm authorized doctor-patient relationship before listing document identifiers.",
            reason: "High clinical restricted tier requires verified active appointment access.",
            parameters: {
              metadataOnly: true,
              rawClinicalBytesExposed: false,
            },
            idempotencyKey,
            expiresAt: expiresIso,
          }
        : undefined;

    return {
      id: createId("msg"),
      role: "assistant",
      createdAt: nowIso,
      status: "sent",
      content:
        role === "DOCTOR"
          ? "Clinical records are protected under Quick-Clinic's high-restriction policy: only document IDs and metadata for patients with an eligible appointment are surfaced, and raw clinical files are never piped into generic prompts."
          : "In live mode, I list your own medical document metadata via ClinicalDocumentsToolInterface without exposing raw file bytes or storage URLs. You can also manage and preview your files directly in Medical Documents.",
      toolActivities: [
        {
          id: createId("tool"),
          toolName: "ClinicalDocumentsToolInterface.list_patient_documents",
          actionType,
          riskLevel: "HIGH_CLINICAL_RESTRICTED",
          status: approval ? "awaiting_approval" : "completed",
          summary: approval
            ? "Awaiting clinical access verification before listing record metadata."
            : "Prepared metadata-only clinical document lookup contract.",
          startedAt: nowIso,
          completedAt: approval ? undefined : nowIso,
          metadata: { metadataOnly: true, piiRedacted: true },
        },
      ],
      approvalRequest: approval,
      citations: [
        {
          label: role === "DOCTOR" ? "Patient Records" : "Medical Documents",
          href: role === "DOCTOR" ? "/doctor/patients" : "/patient/medical-documents",
          type: "document",
        },
      ],
    };
  }

  return {
    id: createId("msg"),
    role: "assistant",
    createdAt: nowIso,
    status: "sent",
    content:
      role === "DOCTOR"
        ? "Frontend preview mode is active. I ran a read-only schedule inspection contract (`LOW_AUTONOMOUS`). Once `/api/ai-agent` endpoints are wired in the backend, I will pull your live daily slots, upcoming appointments, and authorized patient context."
        : "Frontend preview mode is active. I ran a read-only availability lookup contract (`LOW_AUTONOMOUS`). Once `/api/ai-agent` endpoints are wired in the backend, I can search live doctor availability, hold slots with your approval, and help manage your appointments.",
    toolActivities: [
      {
        id: createId("tool"),
        toolName: "DoctorSchedulingToolInterface.get_available_slots",
        actionType: "CHECK_AVAILABILITY",
        riskLevel: "LOW_AUTONOMOUS",
        status: "completed",
        summary: "Read-only availability projection checked (no database mutations).",
        startedAt: nowIso,
        completedAt: nowIso,
        metadata: { readOnly: true, previewMode: true },
      },
    ],
    citations: [
      {
        label: role === "DOCTOR" ? "Today's Schedule" : "Find Doctors",
        href: role === "DOCTOR" ? "/doctor/today" : "/patient/findDoctors",
        type: "doctor",
      },
      {
        label: role === "DOCTOR" ? "All Appointments" : "My Appointments",
        href: role === "DOCTOR" ? "/doctor/appointments" : "/patient/appointments",
        type: "appointment",
      },
    ],
  };
}

export function resolvePreviewApproval(
  approval: AgentApprovalRequest,
  decision: Exclude<ApprovalStatus, "PENDING">,
  decisionReason?: string,
  userId?: string | null
): { approval: AgentApprovalRequest; followUpMessage: AgentMessage } {
  const nowIso = new Date().toISOString();
  const updated: AgentApprovalRequest = {
    ...approval,
    status: decision,
    decidedAt: nowIso,
    decisionReason: decisionReason?.trim() || undefined,
    decidedByUserId: userId || undefined,
  };

  const approved = decision === "APPROVED";
  const followUpMessage: AgentMessage = {
    id: createId("msg"),
    role: "assistant",
    createdAt: nowIso,
    status: "sent",
    content: approved
      ? `Approval recorded for ${approval.actionType} (idempotency key ${approval.idempotencyKey.slice(0, 12)}...). In live mode, the LangGraph checkpoint resumes and executes the validated domain service.`
      : `Action ${approval.actionType} was rejected and aborted cleanly. No clinic records or appointments were modified.${decisionReason?.trim() ? ` Reason noted: "${decisionReason.trim()}".` : ""}`,
    toolActivities: [
      {
        id: createId("tool"),
        toolName: `ApprovalManager.resume(${approval.actionType})`,
        actionType: approval.actionType,
        riskLevel: approval.riskLevel,
        status: approved ? "completed" : "rejected",
        summary: approved
          ? "Human sign-off verified; graph transition simulated in preview mode."
          : "Human sign-off rejected; action aborted without side effects.",
        startedAt: nowIso,
        completedAt: nowIso,
        metadata: {
          approvalId: approval.approvalId,
          decision,
        },
      },
    ],
  };

  return { approval: updated, followUpMessage };
}
