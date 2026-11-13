"use client";

import React, { useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  ShieldAlert,
  Wrench,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ActionRiskLevel, AgentToolActivity, ToolExecutionStatus } from "@/lib/ai-agent/types";

interface ToolActivityProps {
  activities: AgentToolActivity[];
}

const RISK_LABEL: Record<ActionRiskLevel, { label: string; className: string }> = {
  LOW_AUTONOMOUS: {
    label: "Read-only",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  MEDIUM_HUMAN_APPROVAL: {
    label: "Approval Required",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  HIGH_CLINICAL_RESTRICTED: {
    label: "Clinical Restricted",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

function StatusIcon({ status }: { status: ToolExecutionStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="w-3.5 h-3.5 text-indigo-600 animate-spin shrink-0" />;
    case "completed":
      return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />;
    case "awaiting_approval":
      return <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
    case "failed":
    case "rejected":
      return <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />;
    default:
      return <Wrench className="w-3.5 h-3.5 text-muted-foreground shrink-0" />;
  }
}

export function ToolActivity({ activities }: ToolActivityProps) {
  const [expanded, setExpanded] = useState(false);

  if (!activities || activities.length === 0) {
    return null;
  }

  const awaitingCount = activities.filter((a) => a.status === "awaiting_approval").length;

  return (
    <div
      className="rounded-lg border bg-muted/40 text-xs"
      data-testid="agent-tool-activity"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/60 rounded-lg transition-colors"
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Wrench className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          <span className="font-medium text-foreground truncate">
            {activities.length === 1
              ? `1 tool step: ${activities[0].actionType}`
              : `${activities.length} tool steps executed`}
          </span>
          {awaitingCount > 0 && (
            <Badge
              variant="outline"
              className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] px-1.5 py-0"
            >
              Paused for approval
            </Badge>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="border-t px-3 py-2 space-y-2">
          {activities.map((activity) => {
            const risk = RISK_LABEL[activity.riskLevel] ?? RISK_LABEL.LOW_AUTONOMOUS;
            return (
              <div
                key={activity.id}
                className="flex flex-col gap-1 rounded-md bg-background border p-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <StatusIcon status={activity.status} />
                    <span className="font-mono text-[11px] font-medium text-foreground truncate">
                      {activity.toolName}
                    </span>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px] px-1.5 py-0", risk.className)}
                  >
                    {risk.label}
                  </Badge>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {activity.summary}
                </p>
                {activity.metadata && Object.keys(activity.metadata).length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-0.5">
                    {Object.entries(activity.metadata).map(([key, value]) => (
                      <span
                        key={key}
                        className="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground font-mono"
                      >
                        {key}: {String(value)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
