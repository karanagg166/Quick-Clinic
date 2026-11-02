"use client";

import React from "react";
import { useBackendAvailability } from "@/context/backend-availability-context";
import { Loader2, RefreshCw, AlertTriangle, WifiOff } from "lucide-react";

export function BackendStatusBanner() {
  const {
    status,
    isWaking,
    isDegraded,
    isOffline,
    elapsedSeconds,
    errorMessage,
    retry,
  } = useBackendAvailability();

  if (status === "ready" || status === "checking") {
    return null;
  }

  return (
    <aside
      aria-label="Server connectivity status"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-lg border bg-background/95 p-3.5 shadow-lg backdrop-blur-sm transition-all animate-in fade-in slide-in-from-bottom-2 dark:border-border"
    >
      <div className="flex items-start gap-3">
        {isWaking && (
          <div className="mt-0.5 rounded-full bg-amber-500/10 p-1 text-amber-600 dark:text-amber-400">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}
        {isDegraded && (
          <div className="mt-0.5 rounded-full bg-amber-500/10 p-1 text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
          </div>
        )}
        {isOffline && (
          <div className="mt-0.5 rounded-full bg-red-500/10 p-1 text-red-600 dark:text-red-400">
            <WifiOff className="h-4 w-4" />
          </div>
        )}

        <div className="flex-1 text-xs">
          <div className="font-semibold text-foreground">
            {isWaking && `Connecting to server (${elapsedSeconds}s)...`}
            {isDegraded && "Connection delayed"}
            {isOffline && "Connection offline"}
          </div>
          <p className="mt-0.5 text-muted-foreground">
            {errorMessage ||
              (isWaking
                ? "Services are waking from inactivity on free cloud tier."
                : "Unable to establish backend connection.")}
          </p>

          {(isDegraded || isOffline || elapsedSeconds > 40) && (
            <button
              onClick={() => retry()}
              className="mt-2 inline-flex items-center gap-1.5 rounded bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
              Retry Connection
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
