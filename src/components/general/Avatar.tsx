"use client";

import { useState, useEffect } from "react";
import Image from "next/image";

interface Props {
  src?: string | null;
  name?: string;
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
}

const sizeMap = {
  sm: "w-8 h-8 text-xs",
  md: "w-12 h-12 text-sm",
  lg: "w-16 h-16 text-base",
  xl: "w-24 h-24 text-lg",
};

function isValidAvatarUrl(src?: string | null): boolean {
  if (!src || typeof src !== "string" || src.trim() === "") return false;
  try {
    const url = new URL(src);
    // Only allow HTTPS URLs from known image hosts (e.g., Cloudinary)
    // Block all localhost/127.0.0.1 URLs since they reference non-existent services
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return false;
    if (url.protocol !== "https:") return false;
    return true;
  } catch {
    // If it's not a valid URL, reject it
    return false;
  }
}

export default function Avatar({ src, name = "User", size = "md", className = "" }: Props) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [src]);

  const initials = name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2) || "U";

  const sizeClass = sizeMap[size];

  if (src && isValidAvatarUrl(src) && !hasError) {
    return (
      <div className={`${sizeClass} rounded-full overflow-hidden bg-gray-200 flex-shrink-0 relative ${className}`}>
        <Image
          src={src}
          alt={name}
          width={96}
          height={96}
          unoptimized={true}
          onError={() => setHasError(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold flex-shrink-0 ${className}`}
    >
      {initials}
    </div>
  );
}
