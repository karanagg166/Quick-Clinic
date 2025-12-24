"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle, AlertCircle, Calendar } from "lucide-react";

type StatusType = "confirmed" | "pending" | "cancelled" | "completed" | "upcoming";

interface StatusBadgeProps {
  status: StatusType | string;
  className?: string;
  showIcon?: boolean;
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon?: React.ComponentType<{ className?: string }>; className: string }> = {
  confirmed: {
    label: "Confirmed",
    variant: "default",
    icon: CheckCircle2,
    className: "bg-green-500/10 text-green-700 border-green-500/20 hover:bg-green-500/20",
  },
  pending: {
    label: "Pending",
    variant: "secondary",
    icon: Clock,
    className: "bg-amber-500/10 text-amber-700 border-amber-500/20 hover:bg-amber-500/20",
  },
  cancelled: {
    label: "Cancelled",
    variant: "destructive",
    icon: XCircle,
    className: "bg-red-500/10 text-red-700 border-red-500/20 hover:bg-red-500/20",
  },
  completed: {
    label: "Completed",
    variant: "default",
    icon: CheckCircle2,
    className: "bg-blue-500/10 text-blue-700 border-blue-500/20 hover:bg-blue-500/20",
  },
  upcoming: {
    label: "Upcoming",
    variant: "outline",
    icon: Calendar,
    className: "bg-purple-500/10 text-purple-700 border-purple-500/20 hover:bg-purple-500/20",
  },
};

export default function StatusBadge({ status, className, showIcon = true }: StatusBadgeProps) {
  const normalizedStatus = status.toLowerCase();
  const config = statusConfig[normalizedStatus] || {
    label: status,
    variant: "outline" as const,
    className: "bg-gray-500/10 text-gray-700 border-gray-500/20",
  };

  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={cn(
        "flex items-center gap-1.5 border font-medium",
        config.className,
        className
      )}
    >
      {showIcon && Icon && <Icon className="w-3 h-3" />}
      {config.label}
    </Badge>
  );
}

