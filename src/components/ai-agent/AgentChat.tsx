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
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAgentChat } from "@/hooks/useAgentChat";
import { validateAgentMessage } from "@/lib/ai-agent/client";
import { getStarterPromptsForRole } from "@/lib/ai-agent/starters";
import { AgentRole, MAX_AGENT_MESSAGE_LENGTH } from "@/lib/ai-agent/types";
import { cn } from "@/lib/utils";
import { AgentEmptyState } from "./AgentEmptyState";
import { AgentMessage } from "./AgentMessage";
import { AgentThreadSidebar } from "./AgentThreadSidebar";
import { AiPetIcon } from "./AiPetIcon";

interface AgentChatProps {
  role: AgentRole;
  userId?: string | null;
  userName?: string | null;
}

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
  const inputValidation = useMemo(
    () => (input.trim() ? validateAgentMessage(input) : null),
    [input]
  );

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isSending]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (isSending) return;
    if (await sendMessage(input)) setInput("");
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
      ? "Inspect schedules, query authorized patient documents, and stage actions with 60s HITL sign-off."
      : "Explore doctor availability, stage slot holds with approval, and review your medical record metadata.";
  const canSend =
    !isSending &&
    Boolean(input.trim()) &&
    (inputValidation ? inputValidation.valid : true);

  return (
    <div className="max-w-7xl mx-auto">
      <Card className="border shadow-sm overflow-hidden py-0 gap-0">
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
                  {mode === "live" ? "Live Agent API" : "Preview Mode"}
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

        <div className="relative flex h-[calc(100vh-14.5rem)] min-h-[520px] max-h-[820px] bg-background">
          {sidebarOpen && (
            <div
              className="fixed inset-0 bg-black/30 z-20 lg:hidden"
              onClick={() => setSidebarOpen(false)}
              aria-hidden="true"
            />
          )}

          <AgentThreadSidebar
            threads={threads}
            activeThreadId={activeThreadId}
            isLoadingThreads={isLoadingThreads}
            sidebarOpen={sidebarOpen}
            onCloseSidebar={() => setSidebarOpen(false)}
            onSelectThread={selectThread}
            onDeleteThread={deleteThread}
          />

          <div className="flex-1 flex flex-col min-w-0">
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

            <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5" aria-live="polite">
              {messages.length === 0 ? (
                <AgentEmptyState
                  role={role}
                  portalTitle={portalTitle}
                  userName={userName ?? undefined}
                  starterPrompts={starterPrompts}
                  isSending={isSending}
                  onSelectStarter={(prompt) => void sendMessage(prompt)}
                />
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

            {error && (
              <div className="mx-4 mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </span>
                <button type="button" onClick={clearError} aria-label="Dismiss error" className="hover:opacity-75">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <form onSubmit={handleSubmit} className="border-t bg-card p-3 sm:p-4 space-y-2">
              <div className="flex items-end gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    role === "DOCTOR"
                      ? "Ask about today's slots, patient documents, or propose a schedule update..."
                      : "Ask about doctor availability, holding an appointment slot, or your medical documents..."
                  }
                  aria-label="Message AI assistant"
                  rows={2}
                  disabled={isSending}
                  className="min-h-[52px] max-h-36 resize-none text-sm"
                />
                <Button type="submit" size="icon-lg" disabled={!canSend} aria-label="Send message">
                  {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </Button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {inputValidation && !inputValidation.valid ? (
                    <span className="text-destructive font-medium">{inputValidation.error}</span>
                  ) : (
                    "Not a substitute for medical diagnosis. Mutating actions require your explicit sign-off."
                  )}
                </span>
                <span className={cn("font-mono", input.length > MAX_AGENT_MESSAGE_LENGTH ? "text-destructive font-semibold" : "")}>
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
