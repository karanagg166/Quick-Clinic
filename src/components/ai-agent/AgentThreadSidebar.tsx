"use client";

import { Loader2, ShieldCheck, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AgentThreadSummary } from "@/lib/ai-agent/types";
import { cn } from "@/lib/utils";

interface AgentThreadSidebarProps {
  threads: AgentThreadSummary[];
  activeThreadId: string | null;
  isLoadingThreads: boolean;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  onSelectThread: (threadId: string) => void;
  onDeleteThread: (threadId: string) => Promise<void>;
}

export function AgentThreadSidebar({
  threads,
  activeThreadId,
  isLoadingThreads,
  sidebarOpen,
  onCloseSidebar,
  onSelectThread,
  onDeleteThread,
}: AgentThreadSidebarProps) {
  return (
    <aside
      aria-label="Conversation history"
      className={cn(
        "w-72 border-r bg-muted/20 flex flex-col shrink-0 z-30 transition-transform duration-200",
        "fixed inset-y-0 left-0 bg-card lg:static lg:translate-x-0 lg:bg-muted/20",
        sidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"
      )}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Conversations
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onCloseSidebar}
          aria-label="Close conversations panel"
        >
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoadingThreads ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading threads...
          </div>
        ) : (
          threads.map((thread) => {
            const isActive = thread.threadId === activeThreadId;
            return (
              <div
                key={thread.threadId}
                className={cn(
                  "group flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "hover:bg-muted text-foreground"
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectThread(thread.threadId);
                    onCloseSidebar();
                  }}
                  className="flex-1 min-w-0 text-left"
                >
                  <p className="truncate">{thread.title}</p>
                  <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                    <span>
                      {thread.messageCount}{" "}
                      {thread.messageCount === 1 ? "msg" : "msgs"}
                    </span>
                    {thread.pendingApprovals > 0 && (
                      <span className="text-amber-700 font-medium">
                        {thread.pendingApprovals} pending
                      </span>
                    )}
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => void onDeleteThread(thread.threadId)}
                  aria-label={`Delete conversation ${thread.title}`}
                  className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t p-3 space-y-2 bg-muted/30 text-[11px] text-muted-foreground">
        <p className="font-semibold text-foreground flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          Action Safeguards
        </p>
        <ul className="space-y-1">
          <li>
            <span className="font-medium text-emerald-700">Read-only:</span>{" "}
            Schedule &amp; document lookups run automatically.
          </li>
          <li>
            <span className="font-medium text-amber-700">Approval:</span>{" "}
            Mutating actions require sign-off (60s TTL).
          </li>
          <li>
            <span className="font-medium text-rose-700">Clinical:</span>{" "}
            Documents are restricted to authorized doctors.
          </li>
        </ul>
      </div>
    </aside>
  );
}
