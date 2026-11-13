export type AgentRole = "PATIENT" | "DOCTOR";

export type AgentActionType =
  | "CHECK_AVAILABILITY"
  | "GET_DOCTOR_INFO"
  | "PROPOSE_APPOINTMENT"
  | "CANCEL_APPOINTMENT"
  | "RESCHEDULE_APPOINTMENT"
  | "ACCESS_MEDICAL_DOCUMENTS"
  | "SUMMARIZE_VISIT_HISTORY";

export type ActionRiskLevel =
  | "LOW_AUTONOMOUS"
  | "MEDIUM_HUMAN_APPROVAL"
  | "HIGH_CLINICAL_RESTRICTED";

export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type ToolExecutionStatus =
  | "running"
  | "completed"
  | "awaiting_approval"
  | "failed"
  | "rejected";

export type AgentConnectionMode = "live" | "preview";

export const MAX_AGENT_MESSAGE_LENGTH = 6000;

export interface AgentToolActivity {
  id: string;
  toolName: string;
  actionType: AgentActionType;
  riskLevel: ActionRiskLevel;
  status: ToolExecutionStatus;
  summary: string;
  startedAt: string;
  completedAt?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface AgentApprovalRequest {
  approvalId: string;
  actionType: AgentActionType;
  riskLevel: ActionRiskLevel;
  status: ApprovalStatus;
  title: string;
  summary: string;
  reason: string;
  doctorId?: string;
  patientId?: string;
  parameters: Record<string, unknown>;
  idempotencyKey: string;
  expiresAt: string;
  decidedAt?: string;
  decisionReason?: string;
  decidedByUserId?: string;
}

export interface AgentCitation {
  label: string;
  href?: string;
  type: "doctor" | "appointment" | "document" | "schedule";
}

export interface AgentMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  status?: "sending" | "streaming" | "sent" | "error";
  toolActivities?: AgentToolActivity[];
  approvalRequest?: AgentApprovalRequest;
  citations?: AgentCitation[];
  error?: string;
}

export interface AgentThread {
  threadId: string;
  title: string;
  role: AgentRole;
  createdAt: string;
  updatedAt: string;
  messages: AgentMessage[];
}

export interface AgentThreadSummary {
  threadId: string;
  title: string;
  role: AgentRole;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  pendingApprovals: number;
}

export interface SendAgentMessageRequest {
  threadId: string;
  role: AgentRole;
  message: string;
  idempotencyKey: string;
}

export interface SendAgentMessageResponse {
  threadId: string;
  message: AgentMessage;
  mode: AgentConnectionMode;
}

export interface SubmitApprovalRequest {
  threadId: string;
  approvalId: string;
  decision: Exclude<ApprovalStatus, "PENDING">;
  decisionReason?: string;
  idempotencyKey: string;
}

export interface SubmitApprovalResponse {
  threadId: string;
  approval: AgentApprovalRequest;
  followUpMessage?: AgentMessage;
  mode: AgentConnectionMode;
}

export interface AgentStarterPrompt {
  id: string;
  title: string;
  prompt: string;
  actionType: AgentActionType;
  riskLevel: ActionRiskLevel;
  description: string;
}
