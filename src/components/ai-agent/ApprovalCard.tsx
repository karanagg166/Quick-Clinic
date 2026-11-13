"use client";

import React, { useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AgentApprovalRequest, ApprovalStatus } from "@/lib/ai-agent/types";

interface ApprovalCardProps {
  approval: AgentApprovalRequest;
  isProcessing?: boolean;
  onDecide: (
    approvalId: string,
    decision: Exclude<ApprovalStatus, "PENDING">,
    reason?: string
  ) => void | Promise<unknown>;
}

function formatRemainingTime(expiresAt: string, nowMs: number): {
  expired: boolean;
  label: string;
} {
  const diffMs = new Date(expiresAt).getTime() - nowMs;
  if (Number.isNaN(diffMs) || diffMs <= 0) {
    return { expired: true, label: "Expired" };
  }
  const totalSeconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return {
    expired: false,
    label: minutes > 0 ? `${minutes}m ${seconds.toString().padStart(2, "0")}s` : `${seconds}s`,
  };
}

export function ApprovalCard({
  approval,
  isProcessing = false,
  onDecide,
}: ApprovalCardProps) {
  const [decisionNote, setDecisionNote] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  const isPending = approval.status === "PENDING";

  useEffect(() => {
    if (!isPending) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPending]);

  const ttl = formatRemainingTime(approval.expiresAt, nowMs);
  const isActionable = isPending && !ttl.expired;

  const isHighRisk = approval.riskLevel === "HIGH_CLINICAL_RESTRICTED";

  const statusBadge = (() => {
    if (approval.status === "APPROVED") {
      return (
        <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100">
          <CheckCircle2 className="w-3 h-3" />
          Approved
        </Badge>
      );
    }
    if (approval.status === "REJECTED") {
      return (
        <Badge className="bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100">
          <XCircle className="w-3 h-3" />
          Rejected
        </Badge>
      );
    }
    if (ttl.expired) {
      return (
        <Badge variant="outline" className="bg-muted text-muted-foreground">
          <Clock className="w-3 h-3" />
          Expired
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className={cn(
          isHighRisk
            ? "bg-rose-50 text-rose-700 border-rose-200"
            : "bg-amber-50 text-amber-800 border-amber-200"
        )}
      >
        <ShieldAlert className="w-3 h-3" />
        Awaiting Sign-off
      </Badge>
    );
  })();

  const parameterEntries = Object.entries(approval.parameters || {});

  return (
    <div
      data-testid={`approval-card-${approval.approvalId}`}
      className={cn(
        "rounded-xl border p-4 space-y-3 transition-colors",
        approval.status === "APPROVED"
          ? "bg-emerald-50/40 border-emerald-200"
          : approval.status === "REJECTED"
          ? "bg-rose-50/40 border-rose-200"
          : isHighRisk
          ? "bg-rose-50/30 border-rose-200"
          : "bg-amber-50/40 border-amber-200"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
            <h4 className="text-sm font-semibold text-foreground">{approval.title}</h4>
            <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
              {approval.actionType}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">{approval.summary}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {statusBadge}
          {isPending && (
            <span
              className={cn(
                "text-[11px] font-medium flex items-center gap-1",
                ttl.expired ? "text-destructive" : "text-muted-foreground"
              )}
            >
              <Clock className="w-3 h-3" />
              {ttl.expired ? "Approval window expired" : `Expires in ${ttl.label}`}
            </span>
          )}
        </div>
      </div>

      {parameterEntries.length > 0 && (
        <div className="rounded-lg bg-background/80 border p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          {parameterEntries.map(([key, value]) => (
            <div key={key} className="min-w-0">
              <span className="text-muted-foreground font-medium">{key}: </span>
              <span className="text-foreground font-mono break-all">
                {typeof value === "object" ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          Reason: <span className="text-foreground">{approval.reason}</span>
        </span>
        <span className="font-mono">
          Key: {approval.idempotencyKey.slice(0, 14)}...
        </span>
      </div>

      {isActionable ? (
        <div className="pt-1 space-y-2.5 border-t border-border/60">
          <Input
            value={decisionNote}
            onChange={(e) => setDecisionNote(e.target.value)}
            placeholder="Optional note or reason for approval/rejection..."
            aria-label="Approval decision note"
            className="h-8 text-xs bg-background"
            disabled={isProcessing}
            maxLength={300}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isProcessing}
              onClick={() => onDecide(approval.approvalId, "REJECTED", decisionNote)}
              className="text-rose-700 border-rose-200 hover:bg-rose-50 hover:text-rose-800"
            >
              {isProcessing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <XCircle className="w-3.5 h-3.5" />
              )}
              Reject
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isProcessing}
              onClick={() => onDecide(approval.approvalId, "APPROVED", decisionNote)}
            >
              {isProcessing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              Approve &amp; Continue
            </Button>
          </div>
        </div>
      ) : (
        approval.decidedAt && (
          <div className="text-[11px] text-muted-foreground border-t border-border/60 pt-2 flex flex-wrap items-center justify-between gap-2">
            <span>
              Decision recorded at{" "}
              {new Date(approval.decidedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            {approval.decisionReason && (
              <span className="italic truncate max-w-full">
                Note: &ldquo;{approval.decisionReason}&rdquo;
              </span>
            )}
          </div>
        )
      )}
    </div>
  );
}
