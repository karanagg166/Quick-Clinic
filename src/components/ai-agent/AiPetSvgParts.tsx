import React from "react";

interface AiPetDefsProps {
  shellGradId: string;
  rimGradId: string;
  visorGradId: string;
  eyeGradId: string;
  pearlGradId: string;
  auraGradId: string;
}

export function AiPetSvgDefs({
  shellGradId,
  rimGradId,
  visorGradId,
  eyeGradId,
  pearlGradId,
  auraGradId,
}: AiPetDefsProps) {
  return (
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
  );
}

export function AiPetExpression({
  mood,
  eyeGradId,
}: {
  mood: "idle" | "thinking" | "excited";
  eyeGradId: string;
}) {
  if (mood === "thinking") {
    return (
      <g>
        <circle cx="24" cy="33.5" r="2.6" fill="#34d399" className="animate-pulse" />
        <circle cx="32" cy="33.5" r="2.9" fill="#22d3ee" className="animate-bounce" />
        <circle cx="40" cy="33.5" r="2.6" fill="#818cf8" className="animate-pulse" />
        <path
          d="M25 41H39"
          stroke="#22d3ee"
          strokeOpacity="0.65"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray="3 3"
        />
      </g>
    );
  }
  if (mood === "excited") {
    return (
      <g>
        <path d="M20.5 34.5C22 30.8 26 30.8 27.5 34.5" stroke={`url(#${eyeGradId})`} strokeWidth="3.1" strokeLinecap="round" />
        <path d="M36.5 34.5C38 30.8 42 30.8 43.5 34.5" stroke={`url(#${eyeGradId})`} strokeWidth="3.1" strokeLinecap="round" />
        <path d="M27.5 39.2C29.3 42.2 34.7 42.2 36.5 39.2" stroke="#6ee7b7" strokeWidth="2.1" strokeLinecap="round" />
        <path d="M49.5 16L50.3 18.2L52.5 19L50.3 19.8L49.5 22L48.7 19.8L46.5 19L48.7 18.2L49.5 16Z" fill="#fbbf24" />
      </g>
    );
  }
  return (
    <g>
      <rect x="21.2" y="28.5" width="5.6" height="8.4" rx="2.8" fill={`url(#${eyeGradId})`} />
      <circle cx="23.1" cy="30.8" r="1.15" fill="#ffffff" fillOpacity="0.95" />
      <rect x="37.2" y="28.5" width="5.6" height="8.4" rx="2.8" fill={`url(#${eyeGradId})`} />
      <circle cx="39.1" cy="30.8" r="1.15" fill="#ffffff" fillOpacity="0.95" />
      <path d="M28.5 40C30.2 41.7 33.8 41.7 35.5 40" stroke="#6ee7b7" strokeOpacity="0.9" strokeWidth="1.9" strokeLinecap="round" />
    </g>
  );
}
