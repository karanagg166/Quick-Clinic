"use client";

import React, { useState } from "react";
import { usePathname } from "next/navigation";
import { AgentRole } from "@/lib/ai-agent/types";
import { cn } from "@/lib/utils";
import { useUserStore } from "@/store/userStore";
import { AiPetIcon } from "./AiPetIcon";
import { FloatingAgentChatPanel } from "./FloatingAgentChatPanel";

interface FloatingAgentWidgetProps {
  role: AgentRole;
}

export function FloatingAgentWidget({ role }: FloatingAgentWidgetProps) {
  const pathname = usePathname();
  const user = useUserStore((state) => state.user);
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isOnAssistantPage =
    pathname?.startsWith("/patient/assistant") ||
    pathname?.startsWith("/doctor/assistant");

  if (isOnAssistantPage) return null;

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
            <AiPetIcon size="lg" mood={isHovered ? "excited" : "idle"} showGlow />
            <span
              aria-hidden="true"
              className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-slate-950"
            >
              <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
            </span>
          </span>

          <span className="flex flex-col items-start text-left leading-tight">
            <span className="text-xs font-bold tracking-tight text-white">Ask AI</span>
            <span className="text-[10px] font-medium text-emerald-300/90">{petBadgeLabel}</span>
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
