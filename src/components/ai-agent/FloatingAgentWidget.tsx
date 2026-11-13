"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  Loader2,
  Maximize2,
  MessageSquarePlus,
  Send,
  ShieldAlert,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useAgentChat } from "@/hooks/useAgentChat";
import { validateAgentMessage } from "@/lib/ai-agent/client";
import { getStarterPromptsForRole } from "@/lib/ai-agent/preview";
import { AgentRole, MAX_AGENT_MESSAGE_LENGTH } from "@/lib/ai-agent/types";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/store/userStore";
import { AgentMessage } from "./AgentMessage";
import { AiPetIcon } from "./AiPetIcon";

interface FloatingAgentWidgetProps {
  role: AgentRole;
}

interface FloatingAgentChatPanelProps {
  role: AgentRole;
  userId?: string | null;
  userName?: string | null;
  onClose: () => void;
}

function FloatingAgentChatPanel({
  role,
  userId,
  userName,
  onClose,
}: FloatingAgentChatPanelProps) {
  const [input, setInput] = useState("");
  const scrollBottomRef = useRef<HTMLDivElement | null>(null);

  const {
    messages,
    pendingApprovals,
    mode,
    isSending,
    processingApprovalId,
    error,
    createThread,
    sendMessage,
    decideApproval,
    retryMessage,
    clearError,
  } = useAgentChat({ role, userId });

  const starterPrompts = useMemo(
    () => getStarterPromptsForRole(role).slice(0, 3),
    [role]
  );

  const inputValidation = useMemo(() => {
    if (!input.trim()) return null;
    return validateAgentMessage(input);
  }, [input]);

  useEffect(() => {
    scrollBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, isSending]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  const assistantHref =
    role === "DOCTOR" ? "/doctor/assistant" : "/patient/assistant";
  const petTitle =
    role === "DOCTOR" ? "Ask AI Clinical Pet" : "Ask AI Care Pet";

  const canSend =
    !isSending &&
    Boolean(input.trim()) &&
    (inputValidation ? inputValidation.valid : true);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!canSend) return;
    const ok = await sendMessage(input);
    if (ok) {
      setInput("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[calc(100vw-2rem)] sm:w-[410px] h-[560px] max-h-[calc(100vh-6.5rem)]">
      <Card
        data-testid="floating-ai-chat-panel"
        role="dialog"
        aria-label={petTitle}
        className="flex flex-col h-full w-full overflow-hidden py-0 gap-0 border border-emerald-500/25 shadow-2xl bg-card"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 text-white">
          <div className="flex items-center gap-2.5 min-w-0">
            <AiPetIcon
              size="sm"
              mood={isSending ? "thinking" : "excited"}
              showGlow
            />
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-sm font-bold truncate">{petTitle}</h2>
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-1.5 py-0 border",
                    mode === "live"
                      ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                      : "bg-indigo-500/15 text-indigo-200 border-indigo-400/30"
                  )}
                >
                  {mode === "live" ? "Live" : "Preview"}
                </Badge>
              </div>
              <p className="text-[11px] text-slate-300 truncate">
                {role === "DOCTOR"
                  ? "Schedule, clinical context & sign-offs"
                  : "Doctor slots, booking holds & records"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => createThread()}
              aria-label="New chat"
              title="New chat"
              className="text-slate-200 hover:text-white hover:bg-white/10"
            >
              <MessageSquarePlus className="w-4 h-4" />
            </Button>

            <Button
              asChild
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-slate-200 hover:text-white hover:bg-white/10"
            >
              <Link
                href={assistantHref}
                aria-label="Expand full workspace"
                title="Expand full workspace"
                onClick={onClose}
              >
                <Maximize2 className="w-4 h-4" />
              </Link>
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onClose}
              aria-label="Close AI chat"
              title="Close AI chat"
              className="text-slate-200 hover:text-white hover:bg-white/10"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Pending Approvals Alert Strip */}
        {pendingApprovals.length > 0 && (
          <div className="px-3.5 py-2 bg-amber-50 border-b border-amber-200 flex items-center gap-2 text-xs text-amber-900">
            <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
            <span className="font-medium truncate">
              {pendingApprovals.length === 1
                ? "1 action awaiting your approval below"
                : `${pendingApprovals.length} actions awaiting your approval`}
            </span>
          </div>
        )}

        {/* Message Feed */}
        <div
          className="flex-1 overflow-y-auto p-3.5 space-y-4 bg-background"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="py-3 space-y-4">
              <div className="flex flex-col items-center text-center space-y-2 px-2">
                <AiPetIcon size="xl" mood="excited" showGlow />
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-foreground">
                    {userName ? `Hi ${userName}, I'm PulsePet!` : "Hi, I'm PulsePet!"}
                  </h3>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {role === "DOCTOR"
                      ? "Ask me about your open slots, today's patient queue, or stage schedule actions."
                      : "Ask me to find doctors, check slot availability, or help manage your visits."}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                {starterPrompts.map((starter) => (
                  <button
                    key={starter.id}
                    type="button"
                    disabled={isSending}
                    onClick={() => void sendMessage(starter.prompt)}
                    className="w-full text-left rounded-xl border bg-card px-3 py-2.5 hover:border-emerald-500/40 hover:bg-emerald-50/40 dark:hover:bg-emerald-950/20 transition-colors disabled:opacity-50"
                  >
                    <p className="text-xs font-semibold text-foreground">
                      {starter.title}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                      {starter.description}
                    </p>
                  </button>
                ))}
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
            <div className="flex items-center gap-2.5">
              <AiPetIcon size="sm" mood="thinking" showGlow />
              <div className="rounded-2xl rounded-bl-sm border bg-card px-3.5 py-2 text-xs text-muted-foreground flex items-center gap-2">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                PulsePet is thinking...
              </div>
            </div>
          )}

          <div ref={scrollBottomRef} />
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mx-3 mb-2 rounded-lg border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive flex items-center justify-between gap-2">
            <span className="flex items-center gap-1.5 min-w-0 truncate">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{error}</span>
            </span>
            <button
              type="button"
              onClick={clearError}
              aria-label="Dismiss error"
              className="hover:opacity-75 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Composer */}
        <form
          onSubmit={handleSubmit}
          className="border-t bg-card p-3 space-y-1.5"
        >
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={
                role === "DOCTOR"
                  ? "Ask PulsePet about slots or patients..."
                  : "Ask PulsePet about doctors or slots..."
              }
              aria-label="Message AI assistant"
              rows={2}
              disabled={isSending}
              className="min-h-[46px] max-h-28 resize-none text-xs"
            />
            <Button
              type="submit"
              size="icon"
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

          <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span className="truncate">
              {inputValidation && !inputValidation.valid ? (
                <span className="text-destructive font-medium">
                  {inputValidation.error}
                </span>
              ) : (
                "Enter to send • Shift+Enter for newline"
              )}
            </span>
            <span
              className={cn(
                "font-mono shrink-0",
                input.length > MAX_AGENT_MESSAGE_LENGTH
                  ? "text-destructive font-semibold"
                  : ""
              )}
            >
              {input.length}/{MAX_AGENT_MESSAGE_LENGTH}
            </span>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function FloatingAgentWidget({ role }: FloatingAgentWidgetProps) {
  const pathname = usePathname();
  const user = useUserStore((state) => state.user);

  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isOnAssistantPage =
    pathname?.startsWith("/patient/assistant") ||
    pathname?.startsWith("/doctor/assistant");

  if (isOnAssistantPage) {
    return null;
  }

  const petBadgeLabel = role === "DOCTOR" ? "AI Copilot" : "Care Pet";

  if (!isOpen) {
    return (
      <div className="fixed bottom-5 right-5 z-50">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          aria-label="Ask AI Assistant"
          data-testid="floating-ai-pet-trigger"
          className={cn(
            "group relative flex items-center gap-2.5 rounded-full pl-2 pr-4 py-1.5",
            "bg-slate-950/95 text-white backdrop-blur-md",
            "border border-emerald-400/40 shadow-[0_10px_30px_-5px_rgba(16,185,129,0.45)]",
            "hover:border-cyan-300/70 hover:shadow-[0_14px_36px_-4px_rgba(34,211,238,0.55)]",
            "hover:-translate-y-0.5 active:translate-y-0 transition-all duration-300 cursor-pointer"
          )}
        >
          <span className="relative flex items-center justify-center">
            <AiPetIcon
              size="lg"
              mood={isHovered ? "excited" : "idle"}
              showGlow
            />
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950"
            >
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
            </span>
          </span>

          <span className="flex flex-col items-start text-left leading-tight">
            <span className="text-xs font-bold tracking-tight text-white">
              Ask AI
            </span>
            <span className="text-[10px] font-medium text-emerald-300/90">
              {petBadgeLabel}
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <FloatingAgentChatPanel
      role={role}
      userId={user?.id}
      userName={user?.name}
      onClose={() => setIsOpen(false)}
    />
  );
}
