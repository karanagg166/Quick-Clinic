"use client";

import React, { useId } from "react";
import { cn } from "@/lib/utils";

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

/**
 * Animated clinical cyber-pet companion mascot ("PulsePet") for the Quick-Clinic AI Agent.
 * Compatible with `{ className?: string }` icon slots in navigation menus and quick actions.
 */
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
        <defs>
          <linearGradient id={shellGradId} x1="12" y1="12" x2="52" y2="56" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#f8fafc" />
            <stop offset="55%" stopColor="#e2e8f0" />
            <stop offset="100%" stopColor="#cbd5e1" />
          </linearGradient>

          <linearGradient id={rimGradId} x1="10" y1="14" x2="54" y2="54" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="50%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>

          <linearGradient id={visorGradId} x1="16" y1="20" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#0f172a" />
            <stop offset="55%" stopColor="#0b132b" />
            <stop offset="100%" stopColor="#1e1b4b" />
          </linearGradient>

          <linearGradient id={eyeGradId} x1="20" y1="26" x2="44" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#6ee7b7" />
            <stop offset="55%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#38bdf8" />
          </linearGradient>

          <radialGradient id={pearlGradId} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor="#ecfeff" />
            <stop offset="45%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#0891b2" />
          </radialGradient>

          <linearGradient id={auraGradId} x1="4" y1="24" x2="60" y2="40" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>

        {/* Antenna stem + glowing pearl */}
        <path
          d="M32 14.5V8.5"
          stroke="#64748b"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <circle
          cx="32"
          cy="6.5"
          r={mood === "thinking" ? "4.2" : "3.6"}
          fill={`url(#${pearlGradId})`}
          className={cn(mood !== "idle" && "animate-pulse")}
        />
        <circle cx="30.8" cy="5.3" r="1.1" fill="#ffffff" fillOpacity="0.9" />

        {/* Left & Right acoustic ear pods */}
        <rect
          x="3.5"
          y="25.5"
          width="6.5"
          height="15"
          rx="3.25"
          fill="#1e293b"
          stroke={`url(#${auraGradId})`}
          strokeWidth="1.4"
        />
        <rect
          x="5.3"
          y="29"
          width="2.2"
          height="8"
          rx="1.1"
          fill="#22d3ee"
          className={cn(mood === "thinking" && "animate-pulse")}
        />

        <rect
          x="54"
          y="25.5"
          width="6.5"
          height="15"
          rx="3.25"
          fill="#1e293b"
          stroke={`url(#${auraGradId})`}
          strokeWidth="1.4"
        />
        <rect
          x="56.5"
          y="29"
          width="2.2"
          height="8"
          rx="1.1"
          fill="#34d399"
          className={cn(mood === "thinking" && "animate-pulse")}
        />

        {/* Sleek rounded cyber-pet head chassis */}
        <rect
          x="9"
          y="14"
          width="46"
          height="40"
          rx="18"
          fill={`url(#${shellGradId})`}
          stroke={`url(#${rimGradId})`}
          strokeWidth="2.2"
        />

        {/* Soft chin / neck shadow curve */}
        <path
          d="M22 54C25.5 56.2 38.5 56.2 42 54"
          stroke="#94a3b8"
          strokeWidth="2"
          strokeLinecap="round"
          strokeOpacity="0.45"
        />

        {/* Clinical diamond pulse crest on forehead */}
        <path
          d="M32 16.3L33.8 18.1L32 19.9L30.2 18.1L32 16.3Z"
          fill="#10b981"
        />

        {/* Deep obsidian glass visor */}
        <rect
          x="14"
          y="21"
          width="36"
          height="26"
          rx="11.5"
          fill={`url(#${visorGradId})`}
          stroke="#334155"
          strokeWidth="1.2"
        />

        {/* Glossy visor top-left reflection */}
        <path
          d="M19 25.5C22.5 23.2 28.5 23 32.5 23.2"
          stroke="#ffffff"
          strokeOpacity="0.22"
          strokeWidth="1.6"
          strokeLinecap="round"
        />

        {/* Rosy/cyan cheek LEDs */}
        <ellipse
          cx="19.5"
          cy="39.2"
          rx="2.6"
          ry="1.5"
          fill="#fb7185"
          fillOpacity={mood === "excited" ? "0.9" : "0.6"}
        />
        <ellipse
          cx="44.5"
          cy="39.2"
          rx="2.6"
          ry="1.5"
          fill="#fb7185"
          fillOpacity={mood === "excited" ? "0.9" : "0.6"}
        />

        {/* Mood-specific expressive eyes & mouth */}
        {mood === "thinking" ? (
          <g>
            {/* Three animated glowing scan dots */}
            <circle cx="24" cy="33.5" r="2.6" fill="#34d399" className="animate-pulse" />
            <circle cx="32" cy="33.5" r="2.9" fill="#22d3ee" className="animate-bounce" />
            <circle cx="40" cy="33.5" r="2.6" fill="#818cf8" className="animate-pulse" />
            {/* Scanning pulse line */}
            <path
              d="M25 41H39"
              stroke="#22d3ee"
              strokeOpacity="0.65"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeDasharray="3 3"
            />
          </g>
        ) : mood === "excited" ? (
          <g>
            {/* Joyful happy ^ ^ arc eyes */}
            <path
              d="M20.5 34.5C22 30.8 26 30.8 27.5 34.5"
              stroke={`url(#${eyeGradId})`}
              strokeWidth="3.1"
              strokeLinecap="round"
            />
            <path
              d="M36.5 34.5C38 30.8 42 30.8 43.5 34.5"
              stroke={`url(#${eyeGradId})`}
              strokeWidth="3.1"
              strokeLinecap="round"
            />
            {/* Happy open smile */}
            <path
              d="M27.5 39.2C29.3 42.2 34.7 42.2 36.5 39.2"
              stroke="#6ee7b7"
              strokeWidth="2.1"
              strokeLinecap="round"
            />
            {/* Tiny sparkle */}
            <path
              d="M49.5 16L50.3 18.2L52.5 19L50.3 19.8L49.5 22L48.7 19.8L46.5 19L48.7 18.2L49.5 16Z"
              fill="#fbbf24"
            />
          </g>
        ) : (
          <g>
            {/* Soulful glowing pill eyes with catchlights */}
            <rect
              x="21.2"
              y="28.5"
              width="5.6"
              height="8.4"
              rx="2.8"
              fill={`url(#${eyeGradId})`}
            />
            <circle cx="23.1" cy="30.8" r="1.15" fill="#ffffff" fillOpacity="0.95" />

            <rect
              x="37.2"
              y="28.5"
              width="5.6"
              height="8.4"
              rx="2.8"
              fill={`url(#${eyeGradId})`}
            />
            <circle cx="39.1" cy="30.8" r="1.15" fill="#ffffff" fillOpacity="0.95" />

            {/* Friendly gentle smile */}
            <path
              d="M28.5 40C30.2 41.7 33.8 41.7 35.5 40"
              stroke="#6ee7b7"
              strokeOpacity="0.9"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
          </g>
        )}
      </svg>
    </span>
  );
}
