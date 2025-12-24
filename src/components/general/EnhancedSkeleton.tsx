"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";

interface EnhancedSkeletonProps {
  variant?: "card" | "list" | "table" | "text" | "avatar" | "button";
  count?: number;
  className?: string;
  animate?: boolean;
}

export default function EnhancedSkeleton({
  variant = "card",
  count = 1,
  className,
  animate = true,
}: EnhancedSkeletonProps) {
  const variants = {
    card: (
      <div className="space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
      </div>
    ),
    list: (
      <div className="space-y-4">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex items-center gap-4">
            <Skeleton className="h-12 w-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    ),
    table: (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full" />
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    ),
    text: (
      <div className="space-y-2">
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className="h-4 w-full" />
        ))}
      </div>
    ),
    avatar: <Skeleton className="h-12 w-12 rounded-full" />,
    button: <Skeleton className="h-10 w-24" />,
  };

  const content = variants[variant];

  if (!animate) {
    return <div className={cn(className)}>{content}</div>;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
      className={cn(className)}
    >
      {content}
    </motion.div>
  );
}

