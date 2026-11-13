import {
  AgentApprovalRequest,
  AgentConnectionMode,
  AgentMessage,
  AgentRole,
  AgentThread,
  AgentThreadSummary,
  ApprovalStatus,
  MAX_AGENT_MESSAGE_LENGTH,
  SendAgentMessageResponse,
  SubmitApprovalResponse,
} from "./types";
import {
  buildPreviewAgentReply,
  loadPreviewThreads,
  resolvePreviewApproval,
  savePreviewThreads,
} from "./preview";

export interface ValidationResult {
  valid: boolean;
  sanitized: string;
  error?: string;
}

/**
 * Mirrors backend `guardrails.validate_user_message` constraints on the client:
 * non-empty after trimming, <= 6000 chars, and no ASCII control chars (< 32)
 * other than newline, carriage return, or tab.
 */
export function validateAgentMessage(raw: string): ValidationResult {
  if (typeof raw !== "string") {
    return { valid: false, sanitized: "", error: "Message must be text." };
  }

  const sanitized = raw.trim();
  if (!sanitized) {
    return { valid: false, sanitized: "", error: "Please enter a message before sending." };
  }

  if (sanitized.length > MAX_AGENT_MESSAGE_LENGTH) {
    return {
      valid: false,
      sanitized,
      error: `Message exceeds the ${MAX_AGENT_MESSAGE_LENGTH.toLocaleString()} character limit.`,
    };
  }

  for (let i = 0; i < sanitized.length; i += 1) {
    const code = sanitized.charCodeAt(i);
    if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
      return {
        valid: false,
        sanitized,
        error: "Message contains invalid control characters.",
      };
    }
  }

  return { valid: true, sanitized };
}

/**
 * Generates a 16-128 character idempotency key matching backend schema constraints.
 */
export function generateIdempotencyKey(prefix = "qc_agent"): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
  const randomPart =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "")
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
  return `${cleanPrefix}_${randomPart}`.slice(0, 128);
}

export function deriveThreadTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "New conversation";
  return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
}

export function summarizeThread(thread: AgentThread): AgentThreadSummary {
  const pendingApprovals = thread.messages.filter(
    (msg) =>
      msg.approvalRequest &&
      msg.approvalRequest.status === "PENDING" &&
      new Date(msg.approvalRequest.expiresAt).getTime() > Date.now()
  ).length;

  return {
    threadId: thread.threadId,
    title: thread.title,
    role: thread.role,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
    pendingApprovals,
  };
}

function isUnimplementedBackendStatus(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Ignore non-JSON error responses
  }
  return fallback;
}

export const agentClient = {
  async listThreads(
    role: AgentRole,
    userId?: string | null
  ): Promise<{ threads: AgentThread[]; mode: AgentConnectionMode }> {
    try {
      const response = await fetch(`/api/ai-agent/threads?role=${encodeURIComponent(role)}`, {
        method: "GET",
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        const threads = Array.isArray(data?.threads) ? (data.threads as AgentThread[]) : [];
        return { threads, mode: "live" };
      }

      if (!isUnimplementedBackendStatus(response.status)) {
        // For auth/rate-limit errors, keep local threads empty or surface cleanly
        return { threads: loadPreviewThreads(role, userId), mode: "preview" };
      }
    } catch {
      // Network unavailable -> fall back to local preview threads
    }

    return { threads: loadPreviewThreads(role, userId), mode: "preview" };
  },

  async sendMessage(params: {
    threadId: string;
    role: AgentRole;
    message: string;
    idempotencyKey?: string;
    userId?: string | null;
    signal?: AbortSignal;
  }): Promise<SendAgentMessageResponse> {
    const validation = validateAgentMessage(params.message);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid message");
    }

    const idempotencyKey = params.idempotencyKey || generateIdempotencyKey("msg");

    try {
      const response = await fetch("/api/ai-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: params.signal,
        body: JSON.stringify({
          thread_id: params.threadId,
          role: params.role,
          message: validation.sanitized,
          idempotency_key: idempotencyKey,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const assistantMessage: AgentMessage = data?.message ?? {
          id: generateIdempotencyKey("resp"),
          role: "assistant",
          content: typeof data?.reply === "string" ? data.reply : "Response received.",
          createdAt: new Date().toISOString(),
          status: "sent",
          toolActivities: Array.isArray(data?.toolActivities) ? data.toolActivities : undefined,
          approvalRequest: data?.approvalRequest,
          citations: Array.isArray(data?.citations) ? data.citations : undefined,
        };
        return {
          threadId: data?.threadId || params.threadId,
          message: assistantMessage,
          mode: "live",
        };
      }

      if (!isUnimplementedBackendStatus(response.status)) {
        const errMsg = await parseErrorMessage(response, "Failed to reach AI assistant.");
        throw new Error(errMsg);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw error;
      }
      if (error instanceof Error && error.message !== "Failed to fetch" && !error.message.includes("fetch")) {
        throw error;
      }
    }

    // Preview simulation while backend `/api/ai-agent/chat` is not yet wired
    const simulated = buildPreviewAgentReply(params.role, validation.sanitized, idempotencyKey);
    return {
      threadId: params.threadId,
      message: simulated,
      mode: "preview",
    };
  },

  async submitApproval(params: {
    threadId: string;
    approval: AgentApprovalRequest;
    decision: Exclude<ApprovalStatus, "PENDING">;
    decisionReason?: string;
    userId?: string | null;
  }): Promise<SubmitApprovalResponse> {
    if (new Date(params.approval.expiresAt).getTime() <= Date.now()) {
      throw new Error("This approval request has expired. Please ask the assistant to stage a new action.");
    }

    const idempotencyKey = generateIdempotencyKey("appr");

    try {
      const response = await fetch(
        `/api/ai-agent/approvals/${encodeURIComponent(params.approval.approvalId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            thread_id: params.threadId,
            approval_id: params.approval.approvalId,
            decision: params.decision,
            decision_reason: params.decisionReason?.trim() || undefined,
            idempotency_key: idempotencyKey,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        return {
          threadId: data?.threadId || params.threadId,
          approval: data?.approval || {
            ...params.approval,
            status: params.decision,
            decidedAt: new Date().toISOString(),
            decisionReason: params.decisionReason?.trim() || undefined,
          },
          followUpMessage: data?.followUpMessage,
          mode: "live",
        };
      }

      if (!isUnimplementedBackendStatus(response.status)) {
        const errMsg = await parseErrorMessage(response, "Failed to submit approval decision.");
        throw new Error(errMsg);
      }
    } catch (error) {
      if (error instanceof Error && error.message !== "Failed to fetch" && !error.message.includes("fetch")) {
        throw error;
      }
    }

    const preview = resolvePreviewApproval(
      params.approval,
      params.decision,
      params.decisionReason,
      params.userId
    );
    return {
      threadId: params.threadId,
      approval: preview.approval,
      followUpMessage: preview.followUpMessage,
      mode: "preview",
    };
  },

  persistPreviewThreads(role: AgentRole, threads: AgentThread[], userId?: string | null): void {
    savePreviewThreads(role, threads, userId);
  },

  async deleteThread(threadId: string): Promise<void> {
    try {
      await fetch(`/api/ai-agent/threads/${encodeURIComponent(threadId)}`, {
        method: "DELETE",
        credentials: "include",
      });
    } catch {
      // Ignore network errors in preview mode
    }
  },
};
