"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Loader2,
  MessageSquarePlus,
  PanelLeft,
  Send,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAgentChat } from "@/hooks/useAgentChat";
import { validateAgentMessage } from "@/lib/ai-agent/client";
import { getStarterPromptsForRole } from "@/lib/ai-agent/preview";
import {
  ActionRiskLevel,
  AgentRole,
  MAX_AGENT_MESSAGE_LENGTH,
} from "@/lib/ai-agent/types";
import { cn } from "@/lib/utils";
import { AgentMessage } from "./AgentMessage";
import { AiPetIcon } from "./AiPetIcon";

interface AgentChatProps {
  role: AgentRole;
  userId?: string | null;
  userName?: string | null;
}

const STARTER_RISK_BADGE: Record<ActionRiskLevel, { label: string; className: string }> = {
  LOW_AUTONOMOUS: {
    label: "Read-only",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  MEDIUM_HUMAN_APPROVAL: {
    label: "Requires Approval",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  HIGH_CLINICAL_RESTRICTED: {
    label: "Clinical Restricted",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

export function AgentChat({ role, userId, userName }: AgentChatProps) {
  const {
    threads,
    activeThreadId,
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
  } = useAgentChat({ role, userId });

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);

  const starterPrompts = useMemo(() => getStarterPromptsForRole(role), [role]);

  const inputValidation = useMemo(() => {
    if (!input.trim()) return null;
    return validateAgentMessage(input);
  }, [input]);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isSending]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSending) return;
    const ok = await sendMessage(input);
    if (ok) {
      setInput("");
    }
  };

  const handleStarterClick = async (prompt: string) => {
    if (isSending) return;
    await sendMessage(prompt);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const portalTitle =
    role === "DOCTOR" ? "Clinical AI Copilot" : "Quick-Clinic Care Assistant";
  const portalSubtitle =
    role === "DOCTOR"
      ? "Inspect schedules, check authorized clinical metadata, and stage appointment actions with sign-off."
      : "Explore doctor availability, stage slot holds with approval, and review your medical record metadata.";

  const canSend =
    !isSending &&
    Boolean(input.trim()) &&
    (inputValidation ? inputValidation.valid : true);

  return (
    <div className="max-w-7xl mx-auto">
      <Card className="border shadow-sm overflow-hidden py-0 gap-0">
        {/* Top Workspace Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-3.5 border-b bg-card">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="lg:hidden"
              onClick={() => setSidebarOpen((prev) => !prev)}
              aria-label="Toggle conversations panel"
            >
              <PanelLeft className="w-4 h-4" />
            </Button>

            <div className="shrink-0">
              <AiPetIcon size="md" mood={isSending ? "thinking" : "idle"} showGlow />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-base sm:text-lg font-bold text-foreground truncate">
                  {portalTitle}
                </h1>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[11px]",
                    mode === "live"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                      : "bg-indigo-50 text-indigo-700 border-indigo-200"
                  )}
                >
                  {mode === "live" ? "Live Agent API" : "Frontend Preview Mode"}
                </Badge>
                <Badge
                  variant="outline"
                  className="hidden sm:inline-flex text-[11px] bg-muted/60 text-muted-foreground"
                >
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  HITL Guarded
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground truncate hidden sm:block">
                {portalSubtitle}
              </p>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              createThread();
              setSidebarOpen(false);
            }}
          >
            <MessageSquarePlus className="w-4 h-4" />
            New Chat
          </Button>
        </div>

        {/* Main Workspace Split */}
        <div className="relative flex h-[calc(100vh-14.5rem)] min-h-[520px] max-h-[820px] bg-background">
          {/* Mobile Drawer Backdrop */}
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/30 z-20 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          {/* Left Threads Sidebar */}
          <aside
            aria-label="Conversation history"
            className={cn(
              "w-72 border-r bg-muted/20 flex flex-col shrink-0 z-30 transition-transform duration-200",
              "fixed inset-y-0 left-0 bg-card lg:static lg:translate-x-0 lg:bg-muted/20",
              sidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"
            )}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Conversations
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="lg:hidden"
                onClick={() => setSidebarOpen(false)}
                aria-label="Close conversations panel"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {isLoadingThreads ? (
                <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Loading threads...
                </div>
              ) : (
                threads.map((thread) => {
                  const isActive = thread.threadId === activeThreadId;
                  return (
                    <div
                      key={thread.threadId}
                      className={cn(
                        "group flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs transition-colors",
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-muted text-foreground"
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          selectThread(thread.threadId);
                          setSidebarOpen(false);
                        }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <p className="truncate">{thread.title}</p>
                        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                          <span>
                            {thread.messageCount}{" "}
                            {thread.messageCount === 1 ? "msg" : "msgs"}
                          </span>
                          {thread.pendingApprovals > 0 && (
                            <span className="text-amber-700 font-medium">
                              {thread.pendingApprovals} pending
                            </span>
                          )}
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => void deleteThread(thread.threadId)}
                        aria-label={`Delete conversation ${thread.title}`}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {/* Safety & Policy Legend */}
            <div className="border-t p-3 space-y-2 bg-muted/30 text-[11px] text-muted-foreground">
              <p className="font-semibold text-foreground flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Action Safeguards
              </p>
              <ul className="space-y-1">
                <li>
                  <span className="font-medium text-emerald-700">Read-only:</span>{" "}
                  Schedule &amp; slot lookups run automatically.
                </li>
                <li>
                  <span className="font-medium text-amber-700">Approval:</span>{" "}
                  Slot holds &amp; cancellations require sign-off (15m TTL).
                </li>
                <li>
                  <span className="font-medium text-rose-700">Clinical:</span>{" "}
                  Records expose metadata IDs only to authorized users.
                </li>
              </ul>
            </div>
          </aside>

          {/* Right Chat Column */}
          <div className="flex-1 flex flex-col min-w-0">
            {/* Pending Approvals Alert Strip */}
            {pendingApprovals.length > 0 && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2 text-xs text-amber-900">
                <span className="flex items-center gap-2 font-medium">
                  <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                  {pendingApprovals.length === 1
                    ? "1 action is paused and awaiting your Human-in-the-Loop approval."
                    : `${pendingApprovals.length} actions are paused and awaiting your approval.`}
                </span>
                <span className="text-[11px] text-amber-700 hidden sm:inline">
                  Review card below
                </span>
              </div>
            )}

            {/* Message Feed */}
            <div
              className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5"
              aria-live="polite"
            >
              {messages.length === 0 ? (
                <div className="max-w-2xl mx-auto py-4 sm:py-8 space-y-6">
                  <div className="text-center space-y-2">
                    <div className="flex justify-center">
                      <AiPetIcon size="xl" mood="excited" showGlow />
                    </div>
                    <h2 className="text-xl font-bold text-foreground">
                      {userName ? `Hello, ${userName}` : portalTitle}
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-lg mx-auto">
                      {role === "DOCTOR"
                        ? "Ask about your open schedule slots, upcoming appointments, or authorized patient records. Mutating actions always pause for your sign-off."
                        : "Ask about doctor availability, stage a 10-minute appointment hold, or inspect your medical document metadata."}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {starterPrompts.map((starter) => {
                      const risk = STARTER_RISK_BADGE[starter.riskLevel];
                      return (
                        <button
                          key={starter.id}
                          type="button"
                          disabled={isSending}
                          onClick={() => void handleStarterClick(starter.prompt)}
                          className="text-left rounded-xl border bg-card p-3.5 hover:border-primary/40 hover:shadow-xs transition-all space-y-1.5 disabled:opacity-50"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-semibold text-foreground">
                              {starter.title}
                            </span>
                            <Badge
                              variant="outline"
                              className={cn("text-[10px] px-1.5 py-0", risk.className)}
                            >
                              {risk.label}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {starter.description}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                messages.map((message) => (
                  <AgentMessage
                    key={message.id}
                    message={message}
                    processingApprovalId={processingApprovalId}
                    onDecideApproval={decideApproval}
                    onRetry={retryMessage}
                  />
                ))
              )}

              {isSending && (
                <div className="flex items-center gap-3">
                  <AiPetIcon size="sm" mood="thinking" showGlow />
                  <div className="rounded-2xl rounded-bl-sm border bg-card px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    Checking policies and clinic tools...
                  </div>
                </div>
              )}

              <div ref={scrollBottomRef} />
            </div>

            {/* Error Banner */}
            {error && (
              <div className="mx-4 mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </span>
                <button
                  type="button"
                  onClick={clearError}
                  aria-label="Dismiss error"
                  className="hover:opacity-75"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Composer */}
            <form
              onSubmit={handleSubmit}
              className="border-t bg-card p-3 sm:p-4 space-y-2"
            >
              <div className="flex items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    role === "DOCTOR"
                      ? "Ask about today's slots, patient visit context, or propose a schedule update..."
                      : "Ask about doctor availability, holding an appointment slot, or your medical documents..."
                  }
                  aria-label="Message AI assistant"
                  rows={2}
                  disabled={isSending}
                  className="min-h-[52px] max-h-36 resize-none text-sm"
                />
                <Button
                  type="submit"
                  size="icon-lg"
                  disabled={!canSend}
                  aria-label="Send message"
                >
                  {isSending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                </Button>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {inputValidation && !inputValidation.valid ? (
                    <span className="text-destructive font-medium">
                      {inputValidation.error}
                    </span>
                  ) : (
                    "Not a substitute for medical diagnosis. Mutating actions require your explicit sign-off."
                  )}
                </span>
                <span
                  className={cn(
                    "font-mono",
                    input.length > MAX_AGENT_MESSAGE_LENGTH ? "text-destructive font-semibold" : ""
                  )}
                >
                  {input.length.toLocaleString()} / {MAX_AGENT_MESSAGE_LENGTH.toLocaleString()}
                </span>
              </div>
            </form>
          </div>
        </div>
      </Card>
    </div>
  );
}
