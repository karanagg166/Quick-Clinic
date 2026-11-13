"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowUpRight,
  Bot,
  Check,
  Copy,
  RefreshCw,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentMessage as AgentMessageType, ApprovalStatus } from "@/lib/ai-agent/types";
import { ToolActivity } from "./ToolActivity";
import { ApprovalCard } from "./ApprovalCard";

interface AgentMessageProps {
  message: AgentMessageType;
  processingApprovalId?: string | null;
  onDecideApproval?: (
    approvalId: string,
    decision: Exclude<ApprovalStatus, "PENDING">,
    reason?: string
  ) => void | Promise<unknown>;
  onRetry?: (messageId: string) => void | Promise<unknown>;
}

function renderFormattedText(content: string) {
  const paragraphs = content.split(/\n{2,}/);

  return paragraphs.map((paragraph, pIdx) => {
    const parts = paragraph.split(/(`[^`]+`)/g);
    return (
      <p key={pIdx} className="whitespace-pre-wrap leading-relaxed">
        {parts.map((part, idx) => {
          if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
            return (
              <code
                key={idx}
                className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground"
              >
                {part.slice(1, -1)}
              </code>
            );
          }
          return <React.Fragment key={idx}>{part}</React.Fragment>;
        })}
      </p>
    );
  });
}

export function AgentMessage({
  message,
  processingApprovalId,
  onDecideApproval,
  onRetry,
}: AgentMessageProps) {
  const [copied, setCopied] = useState(false);

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const handleCopy = async () => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard permission errors
    }
  };

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <div className="rounded-full border bg-muted/60 px-3 py-1 text-xs text-muted-foreground">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid={`agent-message-${message.role}`}
      className={cn(
        "flex gap-3 w-full",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser && (
        <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary border border-primary/20 flex items-center justify-center shrink-0 mt-0.5">
          <Bot className="w-4 h-4" />
        </div>
      )}

      <div
        className={cn(
          "flex flex-col gap-2 max-w-[88%] sm:max-w-[78%]",
          isUser ? "items-end" : "items-start"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm shadow-xs space-y-2",
            isUser
              ? "bg-primary text-primary-foreground rounded-br-sm"
              : "bg-card border text-card-foreground rounded-bl-sm"
          )}
        >
          <div className="space-y-2">{renderFormattedText(message.content)}</div>

          {message.status === "error" && (
            <div className="flex items-center justify-between gap-3 pt-1 text-xs text-rose-200 border-t border-white/20">
              <span className="flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                {message.error || "Failed to send"}
              </span>
              {onRetry && (
                <button
                  type="button"
                  onClick={() => onRetry(message.id)}
                  className="inline-flex items-center gap-1 underline hover:opacity-80"
                >
                  <RefreshCw className="w-3 h-3" />
                  Retry
                </button>
              )}
            </div>
          )}
        </div>

        {!isUser && message.toolActivities && message.toolActivities.length > 0 && (
          <div className="w-full">
            <ToolActivity activities={message.toolActivities} />
          </div>
        )}

        {!isUser && message.approvalRequest && onDecideApproval && (
          <div className="w-full">
            <ApprovalCard
              approval={message.approvalRequest}
              isProcessing={processingApprovalId === message.approvalRequest.approvalId}
              onDecide={onDecideApproval}
            />
          </div>
        )}

        {!isUser && message.citations && message.citations.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {message.citations.map((citation) =>
              citation.href ? (
                <Button
                  key={`${citation.label}-${citation.href}`}
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs px-2.5 rounded-full"
                >
                  <Link href={citation.href}>
                    {citation.label}
                    <ArrowUpRight className="w-3 h-3" />
                  </Link>
                </Button>
              ) : (
                <span
                  key={citation.label}
                  className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground"
                >
                  {citation.label}
                </span>
              )
            )}
          </div>
        )}

        <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
          <span>
            {new Date(message.createdAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {!isUser && (
            <button
              type="button"
              onClick={handleCopy}
              aria-label="Copy response"
              className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span>Copy</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {isUser && (
        <div className="w-8 h-8 rounded-lg bg-secondary text-secondary-foreground border flex items-center justify-center shrink-0 mt-0.5">
          <User className="w-4 h-4" />
        </div>
      )}
    </div>
  );
}
