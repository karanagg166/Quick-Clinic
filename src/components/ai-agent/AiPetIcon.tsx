"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";
import { AiPetExpression, AiPetSvgDefs } from "./AiPetSvgParts";

export interface AiPetIconProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  mood?: "idle" | "thinking" | "excited";
  showGlow?: boolean;
}

const SIZE_CLASSES: Record<NonNullable<AiPetIconProps["size"]>, string> = {
  xs: "w-5 h-5",
  sm: "w-7 h-7",
  md: "w-8 h-8",
  lg: "w-11 h-11",
  xl: "w-14 h-14",
};

export function AiPetIcon({
  className,
  size = "md",
  mood = "idle",
  showGlow = false,
}: AiPetIconProps) {
  const uid = useId().replace(/:/g, "");
  const shellGradId = `qc-pet-shell-${uid}`;
  const rimGradId = `qc-pet-rim-${uid}`;
  const visorGradId = `qc-pet-visor-${uid}`;
  const eyeGradId = `qc-pet-eye-${uid}`;
  const pearlGradId = `qc-pet-pearl-${uid}`;
  const auraGradId = `qc-pet-aura-${uid}`;

  return (
    <span
      data-testid="ai-pet-icon"
      data-mood={mood}
      aria-hidden="true"
      className={cn(
        "relative inline-flex items-center justify-center shrink-0 select-none transition-transform duration-300",
        SIZE_CLASSES[size],
        mood === "excited" && "scale-105",
        className
      )}
    >
      {showGlow && (
        <>
          <span
            className={cn(
              "pointer-events-none absolute -inset-1 rounded-full bg-gradient-to-tr from-emerald-400/45 via-cyan-400/35 to-indigo-500/45 blur-md transition-opacity duration-300",
              mood === "thinking" ? "opacity-95 animate-pulse" : "opacity-75"
            )}
          />
          {mood === "thinking" && (
            <span className="pointer-events-none absolute -inset-0.5 rounded-full border border-cyan-300/60 animate-ping" />
          )}
        </>
      )}

      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="size-full relative z-10 drop-shadow-[0_2px_6px_rgba(16,185,129,0.22)]"
      >
        <AiPetSvgDefs
          shellGradId={shellGradId}
          rimGradId={rimGradId}
          visorGradId={visorGradId}
          eyeGradId={eyeGradId}
          pearlGradId={pearlGradId}
          auraGradId={auraGradId}
        />

        <path d="M32 14.5V8.5" stroke="#64748b" strokeWidth="2.6" strokeLinecap="round" />
        <circle
          cx="32"
          cy="6.5"
          r={mood === "thinking" ? "4.2" : "3.6"}
          fill={`url(#${pearlGradId})`}
          className={cn(mood !== "idle" && "animate-pulse")}
        />
        <circle cx="30.8" cy="5.3" r="1.1" fill="#ffffff" fillOpacity="0.9" />

        <rect x="3.5" y="25.5" width="6.5" height="15" rx="3.25" fill="#1e293b" stroke={`url(#${auraGradId})`} strokeWidth="1.4" />
        <rect x="5.3" y="29" width="2.2" height="8" rx="1.1" fill="#22d3ee" className={cn(mood === "thinking" && "animate-pulse")} />
        <rect x="54" y="25.5" width="6.5" height="15" rx="3.25" fill="#1e293b" stroke={`url(#${auraGradId})`} strokeWidth="1.4" />
        <rect x="56.5" y="29" width="2.2" height="8" rx="1.1" fill="#34d399" className={cn(mood === "thinking" && "animate-pulse")} />

        <rect x="9" y="14" width="46" height="40" rx="18" fill={`url(#${shellGradId})`} stroke={`url(#${rimGradId})`} strokeWidth="2.2" />
        <path d="M22 54C25.5 56.2 38.5 56.2 42 54" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeOpacity="0.45" />
        <path d="M32 16.3L33.8 18.1L32 19.9L30.2 18.1L32 16.3Z" fill="#10b981" />

        <rect x="14" y="21" width="36" height="26" rx="11.5" fill={`url(#${visorGradId})`} stroke="#334155" strokeWidth="1.2" />
        <path d="M19 25.5C22.5 23.2 28.5 23 32.5 23.2" stroke="#ffffff" strokeOpacity="0.22" strokeWidth="1.6" strokeLinecap="round" />

        <ellipse cx="19.5" cy="39.2" rx="2.6" ry="1.5" fill="#fb7185" fillOpacity={mood === "excited" ? "0.9" : "0.6"} />
        <ellipse cx="44.5" cy="39.2" rx="2.6" ry="1.5" fill="#fb7185" fillOpacity={mood === "excited" ? "0.9" : "0.6"} />

        <AiPetExpression mood={mood} eyeGradId={eyeGradId} />
      </svg>
    </span>
  );
}
