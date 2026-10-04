"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";
import { Plus, MessageSquare, Trash2, Loader2 } from "lucide-react";

export interface ConversationSummaryItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  lastMessagePreview?: {
    role: string;
    preview: string;
    createdAt: string;
  } | null;
}

interface DoctorMedicalChatSidebarProps {
  conversations: ConversationSummaryItem[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  isCreating: boolean;
  deletingId: string | null;
}

export function DoctorMedicalChatSidebar({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  isCreating,
  deletingId,
}: DoctorMedicalChatSidebarProps) {
  return (
    <Card className="border shadow-xs bg-card flex flex-col h-[650px] w-full lg:w-80 shrink-0">
      <div className="p-3 border-b flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Conversations</h2>
        </div>
        <Button
          size="sm"
          onClick={onNewConversation}
          disabled={isCreating}
          className="text-xs h-7 gap-1 rounded-md"
        >
          {isCreating ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Plus className="w-3 h-3" />
          )}
          New Chat
        </Button>
      </div>

      <CardContent className="p-2 flex-1 overflow-y-auto space-y-1.5">
        {conversations.length === 0 ? (
          <div className="p-6 text-center text-xs text-muted-foreground space-y-2">
            <MessageSquare className="w-8 h-8 mx-auto text-muted-foreground/40" />
            <p>No conversations yet.</p>
            <p className="text-[11px]">Start a new chat to ask questions about this patient&apos;s medical records.</p>
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = conv.id === activeConversationId;
            const isDeleting = deletingId === conv.id;
            const timeAgo = formatDistanceToNow(new Date(conv.updatedAt), {
              addSuffix: true,
            });

            return (
              <div
                key={conv.id}
                role="button"
                tabIndex={0}
                onClick={() => onSelectConversation(conv.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onSelectConversation(conv.id);
                  }
                }}
                className={`group relative flex items-start justify-between p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                  isActive
                    ? "bg-primary/10 border-primary/30 text-foreground"
                    : "hover:bg-muted/50 border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="min-w-0 flex-1 pr-2 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-xs text-foreground truncate block">
                      {conv.title || "Clinical Q&A"}
                    </span>
                    {conv.messageCount > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-4 px-1 shrink-0">
                        {conv.messageCount}
                      </Badge>
                    )}
                  </div>
                  {conv.lastMessagePreview?.preview && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {conv.lastMessagePreview.preview}
                    </p>
                  )}
                  <span className="text-[10px] text-muted-foreground/80 block">
                    {timeAgo}
                  </span>
                </div>

                <Button
                  variant="ghost"
                  size="icon"
                  disabled={isDeleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive h-6 w-6 shrink-0 transition-opacity"
                  title="Delete conversation"
                >
                  {isDeleting ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </Button>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
