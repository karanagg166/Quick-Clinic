"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  agentClient,
  generateIdempotencyKey,
  summarizeThread,
  validateAgentMessage,
} from "@/lib/ai-agent/client";
import {
  AgentApprovalRequest,
  AgentConnectionMode,
  AgentMessage,
  AgentThread,
} from "@/lib/ai-agent/types";
import { showToast } from "@/lib/toast";
import {
  appendAssistantMessageToThreads,
  appendUserMessageToThreads,
  applyApprovalOutcomeToThreads,
  isDraftThreadId,
  makeEmptyThread,
  markUserMessageFailed,
  type UseAgentChatOptions,
  type UseAgentChatReturn,
} from "./agentChatHelpers";

export type { UseAgentChatOptions, UseAgentChatReturn } from "./agentChatHelpers";

export function useAgentChat({ role, userId }: UseAgentChatOptions): UseAgentChatReturn {
  const [threadList, setThreadList] = useState<AgentThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [mode, setMode] = useState<AgentConnectionMode>("live");
  const [isLoadingThreads, setIsLoadingThreads] = useState<boolean>(true);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [processingApprovalId, setProcessingApprovalId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setIsLoadingThreads(true);
      try {
        const result = await agentClient.listThreads(role, userId);
        if (cancelled) return;
        const initial = result.threads.length > 0 ? result.threads : [makeEmptyThread(role)];
        setThreadList((prev) => (prev.some((t) => t.messages.length > 0) ? prev : initial));
        setActiveThreadId((prev) => prev ?? initial[0].threadId);
        setMode(result.mode);
      } catch (err) {
        if (cancelled) return;
        const fallback = [makeEmptyThread(role)];
        setThreadList(fallback);
        setActiveThreadId(fallback[0].threadId);
        setError(err instanceof Error ? err.message : "Failed to load conversations.");
      } finally {
        if (!cancelled) setIsLoadingThreads(false);
      }
    }
    load();
    return () => {
      cancelled = true;
      abortControllerRef.current?.abort();
    };
  }, [role, userId]);

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
    const interval = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(interval);
  }, [hasPendingStatus]);

  const pendingApprovals = useMemo(
    () =>
      messages
        .map((m) => m.approvalRequest)
        .filter(
          (req): req is AgentApprovalRequest =>
            Boolean(req) &&
            req!.status === "PENDING" &&
            new Date(req!.expiresAt).getTime() > nowMs
        ),
    [messages, nowMs]
  );

  const threads = useMemo(() => threadList.map(summarizeThread), [threadList]);

  const createThread = useCallback(() => {
    const fresh = makeEmptyThread(role);
    setThreadList((prev) => [fresh, ...prev]);
    setActiveThreadId(fresh.threadId);
    setError(null);
    return fresh.threadId;
  }, [role]);

  const selectThread = useCallback((threadId: string) => {
    setActiveThreadId(threadId);
    setError(null);
  }, []);

  const deleteThread = useCallback(
    async (threadId: string) => {
      if (!isDraftThreadId(threadId)) {
        await agentClient.deleteThread(threadId);
      }
      setThreadList((prev) => {
        const filtered = prev.filter((t) => t.threadId !== threadId);
        const next = filtered.length > 0 ? filtered : [makeEmptyThread(role)];
        if (activeThreadId === threadId) setActiveThreadId(next[0].threadId);
        return next;
      });
    },
    [activeThreadId, role]
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
      const localThreadId = targetThread.threadId;
      const userMessageId = generateIdempotencyKey("user_msg");
      const userMessage: AgentMessage = {
        id: userMessageId,
        role: "user",
        content: validation.sanitized,
        createdAt: new Date().toISOString(),
        status: "sent",
      };

      setError(null);
      setIsSending(true);
      setThreadList((prev) =>
        appendUserMessageToThreads(prev, targetThread, userMessage, validation.sanitized)
      );

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await agentClient.sendMessage({
          threadId: isDraftThreadId(localThreadId) ? "" : localThreadId,
          role,
          message: validation.sanitized,
          idempotencyKey: generateIdempotencyKey("turn"),
          userId,
          signal: controller.signal,
        });
        const persistedThreadId = response.threadId || localThreadId;
        setNowMs(Date.now());
        setMode(response.mode);
        setThreadList((prev) =>
          appendAssistantMessageToThreads(prev, localThreadId, persistedThreadId, response.message)
        );
        if (persistedThreadId !== localThreadId) {
          setActiveThreadId(persistedThreadId);
        }
        return true;
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return false;
        const errMsg = err instanceof Error ? err.message : "Unable to reach AI assistant.";
        setError(errMsg);
        showToast.error(errMsg);
        setThreadList((prev) => markUserMessageFailed(prev, localThreadId, userMessageId, errMsg));
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [activeThread, isSending, role, userId]
  );

  const retryMessage = useCallback(
    async (messageId: string) => {
      const target = messages.find((m) => m.id === messageId && m.role === "user");
      if (!target || isSending || !activeThread) return;
      setThreadList((prev) =>
        prev.map((t) =>
          t.threadId === activeThread.threadId
            ? { ...t, messages: t.messages.filter((m) => m.id !== messageId) }
            : t
        )
      );
      await sendMessage(target.content);
    },
    [activeThread, isSending, messages, sendMessage]
  );

  const decideApproval = useCallback(
    async (
      approvalId: string,
      decision: "APPROVED" | "REJECTED",
      decisionReason?: string
    ): Promise<boolean> => {
      if (!activeThread || processingApprovalId) return false;
      const approval = activeThread.messages.find(
        (m) => m.approvalRequest?.approvalId === approvalId
      )?.approvalRequest;
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
        setThreadList((prev) =>
          applyApprovalOutcomeToThreads(
            prev,
            activeThread.threadId,
            approvalId,
            result.approval,
            decision,
            result.followUpMessage
          )
        );
        if (decision === "APPROVED") {
          if (result.approval.executionStatus === "FAILED") {
            showToast.error(
              `Approval recorded, but execution failed${
                result.approval.lastErrorCode
                  ? ` (${result.approval.lastErrorCode})`
                  : ""
              }.`
            );
          } else {
            showToast.success("Action approved and executed.");
          }
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
    [activeThread, processingApprovalId, userId]
  );

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
    clearError: useCallback(() => setError(null), []),
  };
}
