
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

function isPreviewEnabled(): boolean {
  return process.env.NEXT_PUBLIC_AGENT_PREVIEW_ENABLED === "true";
}


export function validateAgentMessage(
  raw: string
): ValidationResult {
  if (typeof raw !== "string") {
    return {
      valid: false,
      sanitized: "",
      error: "Message must be text.",
    };
  }

  const sanitized = raw.trim();

  if (!sanitized) {
    return {
      valid: false,
      sanitized: "",
      error: "Please enter a message before sending.",
    };
  }

  if (sanitized.length > MAX_AGENT_MESSAGE_LENGTH) {
    return {
      valid: false,
      sanitized,
      error: `Message exceeds the ${MAX_AGENT_MESSAGE_LENGTH} character limit.`,
    };
  }

  for (const char of sanitized) {
    const code = char.charCodeAt(0);

    if (
      code < 32 &&
      code !== 10 &&
      code !== 13 &&
      code !== 9
    ) {
      return {
        valid: false,
        sanitized,
        error: "Message contains invalid control characters.",
      };
    }
  }

  return {
    valid: true,
    sanitized,
  };
}


export function generateIdempotencyKey(
  prefix = "qc_agent"
): string {
  const cleanPrefix = prefix
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 20);

  const randomPart = crypto.randomUUID().replace(/-/g, "");

  return `${cleanPrefix}_${randomPart}`.slice(0, 128);
}


export function deriveThreadTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");

  if (!cleaned) {
    return "New conversation";
  }

  return cleaned.length > 48
    ? `${cleaned.slice(0, 45)}...`
    : cleaned;
}


export function summarizeThread(
  thread: AgentThread
): AgentThreadSummary {
  const pendingApprovals = thread.messages.filter(
    (message) =>
      message.approvalRequest?.status === "PENDING" &&
      new Date(
        message.approvalRequest.expiresAt
      ).getTime() > Date.now()
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


function isUnimplementedBackendStatus(
  status: number
): boolean {
  return [404, 405, 501].includes(status);
}


async function parseErrorMessage(
  response: Response,
  fallback: string
): Promise<string> {
  if (response.status === 401) {
    return "Please log in to use the AI assistant.";
  }

  if (response.status === 403) {
    return "You are not authorized to perform this action.";
  }

  if (response.status === 429) {
    return "Too many requests. Please try again later.";
  }

  try {
    const payload = await response.json();

    if (
      typeof payload?.detail === "string" &&
      payload.detail.trim()
    ) {
      return payload.detail;
    }

    if (
      typeof payload?.error === "string" &&
      payload.error.trim()
    ) {
      return payload.error;
    }
  } catch {
    // Use the safe fallback message.
  }

  return fallback;
}


export const agentClient = {

  async listThreads(
    role: AgentRole,
    userId?: string | null
  ): Promise<{
    threads: AgentThread[];
    mode: AgentConnectionMode;
  }> {
    try {
      const response = await fetch(
        `/api/ai-agent/threads?role=${encodeURIComponent(role)}`,
        {
          method: "GET",
          credentials: "include",
          cache: "no-store",
        }
      );

      if (response.ok) {
        const data = await response.json();

        return {
          threads: Array.isArray(data?.threads)
            ? data.threads
            : [],
          mode: "live",
        };
      }

      if (!isUnimplementedBackendStatus(response.status)) {
        throw new Error(
          await parseErrorMessage(
            response,
            "Unable to load conversations."
          )
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.name !== "TypeError"
      ) {
        throw error;
      }
    }

    // The threads API is not implemented yet.
    // These are local preview threads, not server history.
    return {
      threads: loadPreviewThreads(role, userId),
      mode: "preview",
    };
  },


  async sendMessage(params: {
    threadId: string;
    role: AgentRole;
    message: string;
    idempotencyKey?: string;
    userId?: string | null;
    signal?: AbortSignal;
  }): Promise<SendAgentMessageResponse> {

    const validation = validateAgentMessage(
      params.message
    );

    if (!validation.valid) {
      throw new Error(
        validation.error || "Invalid message"
      );
    }

    const idempotencyKey =
      params.idempotencyKey ||
      generateIdempotencyKey("msg");

    let response: Response;

    try {
      response = await fetch(
        "/api/ai-agent/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
          signal: params.signal,

          // The current backend supports single-turn chat.
          // Role comes from the authenticated session,
          // not from client-supplied values.
          body: JSON.stringify({
            message: validation.sanitized,
          }),
        }
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.name === "AbortError"
      ) {
        throw error;
      }

      throw new Error(
        "Cannot connect to the AI assistant backend."
      );
    }

    if (response.ok) {
      const data = await response.json();

      // Supports the current FastAPI response:
      // { "response": "AI reply" }
      const reply =
        typeof data?.response === "string"
          ? data.response
          : typeof data?.reply === "string"
            ? data.reply
            : typeof data?.message?.content === "string"
              ? data.message.content
              : null;

      if (!reply?.trim()) {
        throw new Error(
          "Invalid response from AI assistant."
        );
      }

      const assistantMessage: AgentMessage = {
        id:
          typeof data?.message?.id === "string"
            ? data.message.id
            : generateIdempotencyKey("resp"),

        role: "assistant",

        content: reply,

        createdAt:
          typeof data?.message?.createdAt === "string"
            ? data.message.createdAt
            : new Date().toISOString(),

        status: "sent",

        toolActivities: Array.isArray(data?.toolActivities)
          ? data.toolActivities
          : undefined,

        approvalRequest: data?.approvalRequest,

        citations: Array.isArray(data?.citations)
          ? data.citations
          : undefined,
      };

      return {
        threadId: data?.threadId || params.threadId,
        message: assistantMessage,
        mode: "live",
      };
    }

    if (
      isPreviewEnabled() &&
      isUnimplementedBackendStatus(response.status)
    ) {
      const simulated = buildPreviewAgentReply(
        params.role,
        validation.sanitized,
        idempotencyKey
      );

      return {
        threadId: params.threadId,
        message: simulated,
        mode: "preview",
      };
    }

    throw new Error(
      await parseErrorMessage(
        response,
        "Failed to get a response from the AI assistant."
      )
    );
  },


  async submitApproval(params: {
    threadId: string;
    approval: AgentApprovalRequest;
    decision: Exclude<ApprovalStatus, "PENDING">;
    decisionReason?: string;
    userId?: string | null;
  }): Promise<SubmitApprovalResponse> {

    if (
      new Date(params.approval.expiresAt).getTime() <=
      Date.now()
    ) {
      throw new Error(
        "Approval expired. Please request a new action."
      );
    }

    const idempotencyKey =
      generateIdempotencyKey("appr");

    let response: Response;

    try {
      response = await fetch(
        `/api/ai-agent/approvals/${encodeURIComponent(
          params.approval.approvalId
        )}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            thread_id: params.threadId,
            approval_id: params.approval.approvalId,
            decision: params.decision,
            decision_reason:
              params.decisionReason?.trim() || undefined,
            idempotency_key: idempotencyKey,
          }),
        }
      );
    } catch {
      throw new Error(
        "Cannot connect to the approval service."
      );
    }

    if (response.ok) {
      const data = await response.json();

      return {
        threadId: data?.threadId || params.threadId,

        approval: data?.approval || {
          ...params.approval,
          status: params.decision,
          decidedAt: new Date().toISOString(),
          decisionReason:
            params.decisionReason?.trim() || undefined,
        },

        followUpMessage: data?.followUpMessage,
        mode: "live",
      };
    }

    if (
      isPreviewEnabled() &&
      isUnimplementedBackendStatus(response.status)
    ) {
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
    }

    throw new Error(
      await parseErrorMessage(
        response,
        "Approval could not be submitted."
      )
    );
  },


  persistPreviewThreads(
    role: AgentRole,
    threads: AgentThread[],
    userId?: string | null
  ): void {
    savePreviewThreads(
      role,
      threads,
      userId
    );
  },


  async deleteThread(
    threadId: string
  ): Promise<void> {
    const response = await fetch(
      `/api/ai-agent/threads/${encodeURIComponent(threadId)}`,
      {
        method: "DELETE",
        credentials: "include",
      }
    );

    if (
      response.ok ||
      isUnimplementedBackendStatus(response.status)
    ) {
      return;
    }

    throw new Error(
      await parseErrorMessage(
        response,
        "Unable to delete conversation."
      )
    );
  },
};
