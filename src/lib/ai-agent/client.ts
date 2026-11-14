import {
  AgentApprovalRequest,
  AgentConnectionMode,
  AgentMessage,
  AgentRole,
  AgentThread,
  SendAgentMessageResponse,
  SubmitApprovalResponse,
} from "./types";
import {
  generateIdempotencyKey,
  parseAgentError,
  validateAgentMessage,
} from "./clientHelpers";

export {
  deriveThreadTitle,
  generateIdempotencyKey,
  summarizeThread,
  validateAgentMessage,
  type ValidationResult,
} from "./clientHelpers";

export const agentClient = {
  async listThreads(
    _role: AgentRole,
    _userId?: string | null
  ): Promise<{ threads: AgentThread[]; mode: AgentConnectionMode }> {
    void _role;
    void _userId;

    const response = await fetch("/api/ai-agent/threads", {
      method: "GET",
      credentials: "include",
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(
        await parseAgentError(response, "Failed to load conversation history.")
      );
    }

    const data = await response.json();
    return {
      threads: Array.isArray(data?.threads) ? data.threads : [],
      mode: "live",
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
    const validation = validateAgentMessage(params.message);
    if (!validation.valid) {
      throw new Error(validation.error || "Invalid message");
    }

    const idempotencyKey =
      params.idempotencyKey || generateIdempotencyKey("msg");

    let response: Response;
    try {
      response = await fetch("/api/ai-agent/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        cache: "no-store",
        signal: params.signal,
        body: JSON.stringify({
          message: validation.sanitized,
          threadId: params.threadId || "",
          idempotencyKey,
        }),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw error;
      }
      throw new Error("Cannot connect to the AI assistant backend.");
    }

    if (!response.ok) {
      throw new Error(
        await parseAgentError(
          response,
          "Failed to get a response from the AI assistant."
        )
      );
    }

    const data = await response.json();
    const reply =
      typeof data?.response === "string"
        ? data.response
        : typeof data?.message?.content === "string"
          ? data.message.content
          : null;

    if (!reply?.trim()) {
      throw new Error("Invalid response from AI assistant.");
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
      approvalRequest: data?.approvalRequest || data?.message?.approvalRequest,
      citations: Array.isArray(data?.citations)
        ? data.citations
        : Array.isArray(data?.message?.citations)
          ? data.message.citations
          : undefined,
    };

    return {
      threadId: data?.threadId || params.threadId,
      message: assistantMessage,
      mode: "live",
    };
  },

  async submitApproval(params: {
    threadId: string;
    approval: AgentApprovalRequest;
    decision: "APPROVED" | "REJECTED";
    decisionReason?: string;
    userId?: string | null;
  }): Promise<SubmitApprovalResponse> {
    if (new Date(params.approval.expiresAt).getTime() <= Date.now()) {
      throw new Error("Approval expired. Please request a new action.");
    }

    const idempotencyKey = generateIdempotencyKey("appr");
    let response: Response;

    try {
      response = await fetch(
        `/api/ai-agent/approvals/${encodeURIComponent(
          params.approval.approvalId
        )}/decision`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          cache: "no-store",
          body: JSON.stringify({
            threadId: params.threadId,
            decision: params.decision,
            decisionReason: params.decisionReason?.trim() || undefined,
            idempotencyKey,
          }),
        }
      );
    } catch {
      throw new Error("Cannot connect to the approval service.");
    }

    if (!response.ok) {
      throw new Error(
        await parseAgentError(response, "Approval could not be submitted.")
      );
    }

    const data = await response.json();
    return {
      threadId: data?.threadId || params.threadId,
      approval: data?.approval || {
        ...params.approval,
        status: params.decision,
        decidedAt: new Date().toISOString(),
        decisionReason: params.decisionReason?.trim() || undefined,
      },
      followUpMessage: data?.resumedMessage || data?.followUpMessage,
      mode: "live",
    };
  },

  async deleteThread(threadId: string): Promise<void> {
    const response = await fetch(
      `/api/ai-agent/threads/${encodeURIComponent(threadId)}`,
      {
        method: "DELETE",
        credentials: "include",
        cache: "no-store",
      }
    );

    if (!response.ok) {
      throw new Error(
        await parseAgentError(response, "Failed to delete conversation.")
      );
    }
  },
};
