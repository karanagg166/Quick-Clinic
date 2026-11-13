"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentClient,
  deriveThreadTitle,
  generateIdempotencyKey,
  summarizeThread,
  validateAgentMessage,
} from "@/lib/ai-agent/client";
import type {
  AgentApprovalRequest,
  AgentConnectionMode,
  AgentMessage,
  AgentRole,
  AgentThread,
  AgentThreadSummary,
  ApprovalStatus,
} from "@/lib/ai-agent/types";
import { showToast } from "@/lib/toast";

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
    decision: Exclude<ApprovalStatus, "PENDING">,
    decisionReason?: string
  ) => Promise<boolean>;
  retryMessage: (messageId: string) => Promise<void>;
  clearError: () => void;
}

function makeEmptyThread(role: AgentRole): AgentThread {
  const now = new Date().toISOString();
  return {
    threadId: generateIdempotencyKey("thread"),
    title: "New conversation",
    role,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function useAgentChat({ role, userId }: UseAgentChatOptions): UseAgentChatReturn {
  const [threadList, setThreadList] = useState<AgentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [mode, setMode] = useState<AgentConnectionMode>("preview");
  const [isLoadingThreads, setIsLoadingThreads] = useState<boolean>(true);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [processingApprovalId, setProcessingApprovalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const abortControllerRef = useRef<AbortController | null>(null);

  // Load persisted/backend threads when role or user changes
  useEffect(() => {
    let active = true;

    async function load() {
      if (active) setIsLoadingThreads(true);
      try {
        const { threads, mode: detectedMode } = await agentClient.listThreads(role, userId);
        if (!active) return;
        setMode(detectedMode);
        if (threads.length > 0) {
          const sorted = [...threads].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
          setThreadList(sorted);
          setActiveThreadId(sorted[0].threadId);
        } else {
          const initial = makeEmptyThread(role);
          setThreadList([initial]);
          setActiveThreadId(initial.threadId);
        }
      } finally {
        if (active) setIsLoadingThreads(false);
      }
    }

    void Promise.resolve().then(load);

    return () => {
      active = false;
      abortControllerRef.current?.abort();
    };
  }, [role, userId]);

  const updateAndPersistThreads = useCallback(
    (updater: (prev: AgentThread[]) => AgentThread[]) => {
      setThreadList((prev) => {
        const next = updater(prev);
        agentClient.persistPreviewThreads(role, next, userId);
        return next;
      });
    },
    [role, userId]
  );

  const activeThread = useMemo(
    () => threadList.find((t) => t.threadId === activeThreadId) ?? threadList[0] ?? null,
    [threadList, activeThreadId]
  );

  const messages = useMemo(() => activeThread?.messages ?? [], [activeThread]);

  const hasPendingStatus = useMemo(
    () => messages.some((m) => m.approvalRequest?.status === "PENDING"),
    [messages]
  );

  useEffect(() => {
    if (!hasPendingStatus) return;
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 15_000);
    return () => window.clearInterval(interval);
  }, [hasPendingStatus]);

  const pendingApprovals = useMemo(() => {
    return messages
      .map((m) => m.approvalRequest)
      .filter(
        (req): req is AgentApprovalRequest =>
          Boolean(req) &&
          req!.status === "PENDING" &&
          new Date(req!.expiresAt).getTime() > nowMs
      );
  }, [messages, nowMs]);

  const threads = useMemo(() => threadList.map(summarizeThread), [threadList]);

  const createThread = useCallback(() => {
    const fresh = makeEmptyThread(role);
    updateAndPersistThreads((prev) => [fresh, ...prev]);
    setActiveThreadId(fresh.threadId);
    setError(null);
    return fresh.threadId;
  }, [role, updateAndPersistThreads]);

  const selectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setError(null);
  }, []);

  const deleteThread = useCallback(
    async (threadId: string) => {
      await agentClient.deleteThread(threadId);
      setThreadList((prev) => {
        const filtered = prev.filter((t) => t.threadId !== threadId);
        const next = filtered.length > 0 ? filtered : [makeEmptyThread(role)];
        agentClient.persistPreviewThreads(role, next, userId);
        if (activeThreadId === threadId) {
          setActiveThreadId(next[0].threadId);
        }
        return next;
      });
    },
    [activeThreadId, role, userId]
  );

  const sendMessage = useCallback(
    async (rawMessage: string): Promise<boolean> => {
      if (isSending) return false;

      const validation = validateAgentMessage(rawMessage);
      if (!validation.valid) {
        setError(validation.error || "Invalid message");
        return false;
      }

      const targetThread = activeThread ?? makeEmptyThread(role);
      const targetThreadId = targetThread.threadId;
      const nowIso = new Date().toISOString();
      const userMessageId = generateIdempotencyKey("user_msg");
      const requestIdempotencyKey = generateIdempotencyKey("turn");

      const userMessage: AgentMessage = {
        id: userMessageId,
        role: "user",
        content: validation.sanitized,
        createdAt: nowIso,
        status: "sent",
      };

      setError(null);
      setIsSending(true);

      updateAndPersistThreads(
        (prev) => {
          const exists = prev.some((t) => t.threadId === targetThreadId);
          const baseList = exists ? prev : [targetThread, ...prev];
          return baseList.map((thread) => {
            if (thread.threadId !== targetThreadId) return thread;
            const isFirstUserMessage = !thread.messages.some((m) => m.role === "user");
            return {
              ...thread,
              title: isFirstUserMessage ? deriveThreadTitle(validation.sanitized) : thread.title,
              updatedAt: nowIso,
              messages: [...thread.messages, userMessage],
            };
          });
        }
      );

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await agentClient.sendMessage({
          threadId: targetThreadId,
          role,
          message: validation.sanitized,
          idempotencyKey: requestIdempotencyKey,
          userId,
          signal: controller.signal,
        });

        setNowMs(Date.now());
        setMode(response.mode);
        updateAndPersistThreads(
          (prev) =>
            prev.map((thread) =>
              thread.threadId === targetThreadId
                ? {
                    ...thread,
                    updatedAt: response.message.createdAt,
                    messages: [...thread.messages, response.message],
                  }
                : thread
            )
        );

        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return false;
        }
        const errMsg = err instanceof Error ? err.message : "Unable to reach AI assistant.";
        setError(errMsg);
        showToast.error(errMsg);

        updateAndPersistThreads(
          (prev) =>
            prev.map((thread) =>
              thread.threadId === targetThreadId
                ? {
                    ...thread,
                    messages: thread.messages.map((msg) =>
                      msg.id === userMessageId ? { ...msg, status: "error", error: errMsg } : msg
                    ),
                  }
                : thread
            )
        );

        return false;
      } finally {
        setIsSending(false);
      }
    },
    [activeThread, isSending, role, updateAndPersistThreads, userId]
  );

  const retryMessage = useCallback(
    async (messageId: string) => {
      const target = messages.find((m) => m.id === messageId && m.role === "user");
      if (!target || isSending) return;

      // Remove failed message before resending cleanly
      if (activeThread) {
        updateAndPersistThreads(
          (prev) =>
            prev.map((thread) =>
              thread.threadId === activeThread.threadId
                ? {
                    ...thread,
                    messages: thread.messages.filter((m) => m.id !== messageId),
                  }
                : thread
            )
        );
      }
      await sendMessage(target.content);
    },
    [activeThread, isSending, messages, sendMessage, updateAndPersistThreads]
  );

  const decideApproval = useCallback(
    async (
      approvalId: string,
      decision: Exclude<ApprovalStatus, "PENDING">,
      decisionReason?: string
    ): Promise<boolean> => {
      if (!activeThread || processingApprovalId) return false;

      const sourceMsg = activeThread.messages.find(
        (m) => m.approvalRequest?.approvalId === approvalId
      );
      const approval = sourceMsg?.approvalRequest;
      if (!approval) return false;

      setProcessingApprovalId(approvalId);
      setError(null);

      try {
        const result = await agentClient.submitApproval({
          threadId: activeThread.threadId,
          approval,
          decision,
          decisionReason,
          userId,
        });

        setMode(result.mode);
        updateAndPersistThreads(
          (prev) =>
            prev.map((thread) => {
              if (thread.threadId !== activeThread.threadId) return thread;
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
                        completedAt: result.approval.decidedAt,
                      }
                    : tool
                );
                return {
                  ...msg,
                  approvalRequest: result.approval,
                  toolActivities: updatedTools,
                };
              });

              if (result.followUpMessage) {
                updatedMessages.push(result.followUpMessage);
              }

              return {
                ...thread,
                updatedAt: new Date().toISOString(),
                messages: updatedMessages,
              };
            })
        );

        if (decision === "APPROVED") {
          showToast.success("Action approved and recorded.");
        } else {
          showToast.info("Action rejected.");
        }
        return true;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : "Failed to submit approval decision.";
        setError(errMsg);
        showToast.error(errMsg);
        return false;
      } finally {
        setProcessingApprovalId(null);
      }
    },
    [activeThread, processingApprovalId, updateAndPersistThreads, userId]
  );

  const clearError = useCallback(() => setError(null), []);

  return {
    threads,
    activeThread,
    activeThreadId: activeThread?.threadId ?? null,
    messages,
    pendingApprovals,
    mode,
    isLoadingThreads,
    isSending,
    processingApprovalId,
    error,
    createThread,
    selectThread,
    deleteThread,
    sendMessage,
    decideApproval,
    retryMessage,
    clearError,
  };
}
