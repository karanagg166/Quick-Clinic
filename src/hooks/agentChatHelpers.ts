import {
  deriveThreadTitle,
  generateIdempotencyKey,
} from "@/lib/ai-agent/client";
import {
  AgentApprovalRequest,
  AgentConnectionMode,
  AgentMessage,
  AgentRole,
  AgentThread,
  AgentThreadSummary,
} from "@/lib/ai-agent/types";

export interface UseAgentChatOptions {
  role: AgentRole;
  userId?: string | null;
}

export interface UseAgentChatReturn {
  threads: AgentThreadSummary[];
  activeThread: AgentThread | null;
  activeThreadId: string | null;
  messages: AgentMessage[];
  pendingApprovals: AgentApprovalRequest[];
  mode: AgentConnectionMode;
  isLoadingThreads: boolean;
  isSending: boolean;
  processingApprovalId: string | null;
  error: string | null;
  createThread: () => string;
  selectThread: (threadId: string) => void;
  deleteThread: (threadId: string) => Promise<void>;
  sendMessage: (rawMessage: string) => Promise<boolean>;
  decideApproval: (
    approvalId: string,
    decision: "APPROVED" | "REJECTED",
    decisionReason?: string
  ) => Promise<boolean>;
  retryMessage: (messageId: string) => Promise<void>;
  clearError: () => void;
}

export function makeEmptyThread(role: AgentRole): AgentThread {
  const now = new Date().toISOString();
  return {
    threadId: `draft_${generateIdempotencyKey("thread")}`,
    title: "New conversation",
    role,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function isDraftThreadId(threadId: string): boolean {
  return threadId.startsWith("draft_");
}

export function appendUserMessageToThreads(
  prev: AgentThread[],
  targetThread: AgentThread,
  userMessage: AgentMessage,
  sanitizedText: string
): AgentThread[] {
  const exists = prev.some((t) => t.threadId === targetThread.threadId);
  const baseList = exists ? prev : [targetThread, ...prev];
  return baseList.map((thread) => {
    if (thread.threadId !== targetThread.threadId) return thread;
    const isFirstUser = !thread.messages.some((m) => m.role === "user");
    return {
      ...thread,
      title: isFirstUser ? deriveThreadTitle(sanitizedText) : thread.title,
      updatedAt: userMessage.createdAt,
      messages: [...thread.messages, userMessage],
    };
  });
}

export function appendAssistantMessageToThreads(
  prev: AgentThread[],
  localThreadId: string,
  persistedThreadId: string,
  assistantMessage: AgentMessage
): AgentThread[] {
  return prev.map((thread) =>
    thread.threadId === localThreadId
      ? {
          ...thread,
          threadId: persistedThreadId || thread.threadId,
          updatedAt: assistantMessage.createdAt,
          messages: [...thread.messages, assistantMessage],
        }
      : thread
  );
}

export function markUserMessageFailed(
  prev: AgentThread[],
  threadId: string,
  userMessageId: string,
  errMsg: string
): AgentThread[] {
  return prev.map((thread) =>
    thread.threadId === threadId
      ? {
          ...thread,
          messages: thread.messages.map((msg) =>
            msg.id === userMessageId
              ? { ...msg, status: "error", error: errMsg }
              : msg
          ),
        }
      : thread
  );
}

export function applyApprovalOutcomeToThreads(
  prev: AgentThread[],
  threadId: string,
  approvalId: string,
  approval: AgentApprovalRequest,
  decision: "APPROVED" | "REJECTED",
  followUpMessage?: AgentMessage
): AgentThread[] {
  return prev.map((thread) => {
    if (thread.threadId !== threadId) return thread;
    const updatedMessages = thread.messages.map((msg) => {
      if (msg.approvalRequest?.approvalId !== approvalId) return msg;
      const updatedTools = msg.toolActivities?.map((tool) =>
        tool.status === "awaiting_approval"
          ? {
              ...tool,
              status:
                decision === "APPROVED"
                  ? ("completed" as const)
                  : ("rejected" as const),
              completedAt: approval.decidedAt,
            }
          : tool
      );
      return {
        ...msg,
        approvalRequest: approval,
        toolActivities: updatedTools,
      };
    });

    if (followUpMessage) {
      updatedMessages.push(followUpMessage);
    }

    return {
      ...thread,
      updatedAt: new Date().toISOString(),
      messages: updatedMessages,
    };
  });
}
