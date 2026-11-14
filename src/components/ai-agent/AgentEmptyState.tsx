"use client";

import { Badge } from "@/components/ui/badge";
import { ActionRiskLevel, AgentRole, AgentStarterPrompt } from "@/lib/ai-agent/types";
import { cn } from "@/lib/utils";
import { AiPetIcon } from "./AiPetIcon";

const STARTER_RISK_BADGE: Record<
  ActionRiskLevel,
  { label: string; className: string }
> = {
  LOW_AUTONOMOUS: {
    label: "Read-only",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  MEDIUM_HUMAN_APPROVAL: {
    label: "Approval",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  HIGH_CLINICAL_RESTRICTED: {
    label: "Restricted",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

interface AgentEmptyStateProps {
  role: AgentRole;
  portalTitle: string;
  userName?: string;
  starterPrompts: AgentStarterPrompt[];
  isSending: boolean;
  onSelectStarter: (prompt: string) => void;
}

export function AgentEmptyState({
  role,
  portalTitle,
  userName,
  starterPrompts,
  isSending,
  onSelectStarter,
}: AgentEmptyStateProps) {
  return (
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
            : "Ask about your uploaded medical documents, search doctors & open slots, or manage appointments. Mutating actions always pause for your approval."}
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
              onClick={() => onSelectStarter(starter.prompt)}
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
  );
}
