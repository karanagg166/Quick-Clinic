"use client";

import { useEffect, useState, useCallback, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
import {
  DoctorMedicalDocumentHeader,
  PatientSummary,
  AccessiblePatient,
} from "@/components/doctor/DoctorMedicalDocumentHeader";
import { MedicalRecordAccessDenied } from "@/components/doctor/MedicalRecordAccessDenied";
import {
  DoctorMedicalChatSidebar,
  ConversationSummaryItem,
} from "@/components/doctor/DoctorMedicalChatSidebar";
import { DoctorMedicalChatCitations } from "@/components/doctor/DoctorMedicalChatCitations";
import { MedicalRagCitation } from "@/lib/search-sphere-client";
import {
  Send,
  Loader2,
  Sparkles,
  Bot,
  User,
  ShieldCheck,
  RotateCcw,
  AlertCircle,
} from "lucide-react";

interface RouteParams {
  params: Promise<{
    patientId: string;
  }>;
}

export interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  citations?: MedicalRagCitation[] | null;
  status: "COMPLETE" | "FAILED";
  createdAt: string;
}

export default function DoctorPatientMedicalChatPage({ params }: RouteParams) {
  const resolvedParams = use(params);
  const patientId = resolvedParams.patientId;
  const router = useRouter();

  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [accessiblePatients, setAccessiblePatients] = useState<AccessiblePatient[]>([]);
  const [accessDenied, setAccessDenied] = useState(false);
  const [deniedReason, setDeniedReason] = useState("");
  const [loading, setLoading] = useState(true);

  // Conversations state
  const [conversations, setConversations] = useState<ConversationSummaryItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Input & Streaming state
  const [inputText, setInputText] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState("");
  const [streamError, setStreamError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageCounterRef = useRef(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamedText]);

  // Load accessible patients & verify basic access
  useEffect(() => {
    async function loadAccessiblePatients() {
      try {
        const res = await fetch("/api/doctors/me/medical-record-patients");
        if (res.ok) {
          const list = await res.json();
          setAccessiblePatients(list);
          const current = list.find((p: any) => p.id === patientId);
          if (current) {
            setPatient({
              id: current.id,
              name: current.name,
              age: current.age,
              gender: current.gender,
              profileImageUrl: current.profileImageUrl,
              qualifyingAppointment: {
                id: "qualifying",
                status: current.relationship || "ACTIVE",
              },
            });
          }
        }
      } catch (err) {
        console.error("Failed to load accessible patients:", err);
      }
    }
    loadAccessiblePatients();
  }, [patientId]);

  // Fetch conversations list
  const fetchConversations = useCallback(async () => {
    if (!patientId) return;
    try {
      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-chat/conversations`
      );

      if (res.status === 403) {
        const data = await res.json().catch(() => ({}));
        setAccessDenied(true);
        setDeniedReason(data.error || "Access denied. Eligible appointment required.");
        return;
      }

      if (!res.ok) {
        showToast.error("Failed to load conversations");
        return;
      }

      const data = await res.json();
      const list: ConversationSummaryItem[] = data.conversations || [];
      setConversations(list);

      // Auto-select first conversation if none selected
      if (!activeConversationId && list.length > 0) {
        setActiveConversationId(list[0].id);
        setActiveTitle(list[0].title);
      }
    } catch (err) {
      console.error("Fetch conversations error:", err);
    } finally {
      setLoading(false);
    }
  }, [patientId, activeConversationId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Fetch messages for active conversation
  const fetchMessages = useCallback(
    async (convId: string) => {
      setLoadingMessages(true);
      setStreamError(null);
      try {
        const res = await fetch(
          `/api/doctors/me/patients/${patientId}/medical-chat/conversations/${convId}`
        );

        if (res.status === 403) {
          setAccessDenied(true);
          return;
        }

        if (!res.ok) {
          showToast.error("Failed to load conversation messages");
          return;
        }

        const data = await res.json();
        setMessages(data.messages || []);
        setActiveTitle(data.conversation?.title || null);
      } catch (err) {
        console.error("Fetch messages error:", err);
        showToast.error("Failed to load conversation history");
      } finally {
        setLoadingMessages(false);
      }
    },
    [patientId]
  );

  useEffect(() => {
    if (activeConversationId) {
      fetchMessages(activeConversationId);
    } else {
      setMessages([]);
      setActiveTitle(null);
    }
  }, [activeConversationId, fetchMessages]);

  // Create new conversation
  const handleNewConversation = async () => {
    try {
      setIsCreatingConversation(true);
      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-chat/conversations`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showToast.error(err.error || "Failed to create conversation");
        return;
      }

      const data = await res.json();
      const newConv = data.conversation;
      setConversations((prev) => [
        {
          id: newConv.id,
          title: newConv.title,
          createdAt: newConv.createdAt,
          updatedAt: newConv.updatedAt,
          messageCount: 0,
        },
        ...prev,
      ]);
      setActiveConversationId(newConv.id);
      setActiveTitle(null);
      setMessages([]);
      showToast.success("New conversation started");
    } catch (err) {
      console.error("Create conversation error:", err);
      showToast.error("Could not create conversation");
    } finally {
      setIsCreatingConversation(false);
    }
  };

  // Delete conversation
  const handleDeleteConversation = async (convId: string) => {
    try {
      setDeletingId(convId);
      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-chat/conversations/${convId}`,
        { method: "DELETE" }
      );

      if (!res.ok) {
        showToast.error("Failed to delete conversation");
        return;
      }

      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConversationId === convId) {
        const remaining = conversations.filter((c) => c.id !== convId);
        if (remaining.length > 0) {
          setActiveConversationId(remaining[0].id);
          setActiveTitle(remaining[0].title);
        } else {
          setActiveConversationId(null);
          setActiveTitle(null);
          setMessages([]);
        }
      }
      showToast.success("Conversation deleted");
    } catch (err) {
      console.error("Delete conversation error:", err);
      showToast.error("Failed to delete conversation");
    } finally {
      setDeletingId(null);
    }
  };

  // Send message and stream response via SSE
  const handleSendMessage = async (textToSend?: string) => {
    const query = (textToSend !== undefined ? textToSend : inputText).trim();
    if (!query || isStreaming) return;

    // Ensure conversation exists or create one first
    let convId = activeConversationId;
    if (!convId) {
      try {
        setIsCreatingConversation(true);
        const res = await fetch(
          `/api/doctors/me/patients/${patientId}/medical-chat/conversations`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }
        );
        if (!res.ok) throw new Error("Could not initialize conversation");
        const data = await res.json();
        convId = data.conversation.id;
        setActiveConversationId(convId);
        setConversations((prev) => [
          {
            id: convId!,
            title: data.conversation.title,
            createdAt: data.conversation.createdAt,
            updatedAt: data.conversation.updatedAt,
            messageCount: 0,
          },
          ...prev,
        ]);
      } catch (err: any) {
        showToast.error(err.message || "Failed to start conversation");
        setIsCreatingConversation(false);
        return;
      } finally {
        setIsCreatingConversation(false);
      }
    }

    setInputText("");
    setStreamError(null);
    setStreamedText("");
    setIsStreaming(true);

    // Optimistically append user message to UI
    const tempUserMsg: ChatMessage = {
      id: `temp-${++messageCounterRef.current}`,
      role: "USER",
      content: query,
      status: "COMPLETE",
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const response = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-chat/conversations/${convId}/stream`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: query }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to stream medical response");
      }

      if (!response.body) {
        throw new Error("Empty streaming response body received");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedAnswer = "";
      let receivedCitations: MedicalRagCitation[] = [];
      let finalMessageId = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          const trimmed = part.trim();
          if (!trimmed) continue;

          const lines = trimmed.split("\n");
          let eventType = "message";
          let dataStr = "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              dataStr = line.slice(6).trim();
            }
          }

          if (eventType === "token") {
            try {
              const data = JSON.parse(dataStr);
              accumulatedAnswer += data.text || "";
              setStreamedText(accumulatedAnswer);
            } catch {
              // ignore
            }
          } else if (eventType === "citations") {
            try {
              const data = JSON.parse(dataStr);
              receivedCitations = data.citations || [];
            } catch {
              // ignore
            }
          } else if (eventType === "done") {
            try {
              const data = JSON.parse(dataStr);
              finalMessageId = data.messageId || "";
            } catch {
              // ignore
            }
          } else if (eventType === "error") {
            let errorMsg = "Failed to generate answer";
            try {
              const data = JSON.parse(dataStr);
              errorMsg = data.message || errorMsg;
            } catch {
              errorMsg = dataStr || errorMsg;
            }
            setStreamError(errorMsg);
            showToast.error(errorMsg);
          }
        }
      }

      // Add final assistant message once streaming completes
      if (accumulatedAnswer) {
        const assistantMsg: ChatMessage = {
          id: finalMessageId || `ast-${++messageCounterRef.current}`,
          role: "ASSISTANT",
          content: accumulatedAnswer,
          citations: receivedCitations,
          status: "COMPLETE",
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamedText("");
      }

      // Refresh conversations list to update title/timestamps
      fetchConversations();
    } catch (err: any) {
      console.error("Streaming error:", err);
      setStreamError(err.message || "Failed to receive response");
      showToast.error(err.message || "Chat stream disconnected");
    } finally {
      setIsStreaming(false);
    }
  };

  const handlePatientSwitch = (newId: string) => {
    if (newId && newId !== patientId) {
      router.push(`/doctor/patients/${newId}/medical-chat`);
    }
  };

  if (accessDenied) {
    return <MedicalRecordAccessDenied reason={deniedReason} />;
  }

  const samplePrompts = [
    "What were the recent blood pressure readings?",
    "Summarize findings from the latest lab reports.",
    "Are there any recorded drug allergies or alerts?",
    "What medications are documented in discharge summaries?",
  ];

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-7xl mx-auto">
      {/* Patient Header with Active Tab Switcher */}
      <DoctorMedicalDocumentHeader
        patient={patient}
        accessiblePatients={accessiblePatients}
        currentPatientId={patientId}
        onPatientSwitch={handlePatientSwitch}
        activeTab="chat"
      />

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        {/* Left Sidebar: Conversations List */}
        <DoctorMedicalChatSidebar
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelectConversation={(id) => setActiveConversationId(id)}
          onNewConversation={handleNewConversation}
          onDeleteConversation={handleDeleteConversation}
          isCreating={isCreatingConversation}
          deletingId={deletingId}
        />

        {/* Main Chat Thread */}
        <Card className="border shadow-xs bg-card flex-1 flex flex-col h-[650px] w-full">
          {/* Conversation Top Bar */}
          <div className="p-3.5 border-b flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary shrink-0" />
              <h2 className="text-sm font-semibold text-foreground truncate max-w-md">
                {activeTitle || "Medical Record AI Assistant"}
              </h2>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Grounded in Patient Records</span>
            </div>
          </div>

          {/* Message Thread Content */}
          <CardContent className="p-4 flex-1 overflow-y-auto space-y-4">
            {loadingMessages ? (
              <div className="space-y-4">
                <Skeleton className="h-16 w-3/4 ml-auto rounded-xl" />
                <Skeleton className="h-32 w-5/6 rounded-xl" />
                <Skeleton className="h-20 w-2/3 ml-auto rounded-xl" />
              </div>
            ) : messages.length === 0 && !isStreaming ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-4 max-w-md mx-auto">
                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center text-primary">
                  <Bot className="w-6 h-6" />
                </div>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-foreground">
                    Ask Questions About Patient Medical Records
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Search Sphere retrieves patient-filtered records and generates strictly grounded clinical answers with citations.
                  </p>
                </div>

                <div className="grid gap-2 w-full pt-2">
                  {samplePrompts.map((prompt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleSendMessage(prompt)}
                      className="text-left text-xs p-2.5 rounded-lg border bg-muted/40 hover:bg-muted text-foreground transition-colors"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((msg) => {
                  const isUser = msg.role === "USER";

                  return (
                    <div
                      key={msg.id}
                      className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      {!isUser && (
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                          <Bot className="w-4 h-4" />
                        </div>
                      )}

                      <div
                        className={`max-w-[85%] sm:max-w-[78%] rounded-2xl p-3.5 text-xs shadow-2xs ${
                          isUser
                            ? "bg-primary text-primary-foreground rounded-tr-xs"
                            : "bg-muted/40 border text-foreground rounded-tl-xs space-y-2"
                        }`}
                      >
                        <div className="leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </div>

                        {/* Citations block for assistant messages */}
                        {!isUser && msg.citations && msg.citations.length > 0 && (
                          <DoctorMedicalChatCitations
                            patientId={patientId}
                            citations={msg.citations}
                          />
                        )}
                      </div>

                      {isUser && (
                        <div className="w-7 h-7 rounded-full bg-muted text-muted-foreground flex items-center justify-center shrink-0 mt-0.5">
                          <User className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Progressively Streaming Assistant Message */}
                {isStreaming && (
                  <div className="flex gap-3 justify-start" data-testid="streaming-message">
                    <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
                      <Bot className="w-4 h-4" />
                    </div>
                    <div className="max-w-[85%] sm:max-w-[78%] rounded-2xl rounded-tl-xs p-3.5 text-xs bg-muted/40 border text-foreground space-y-2 shadow-2xs">
                      <div className="leading-relaxed whitespace-pre-wrap">
                        {streamedText || (
                          <span className="text-muted-foreground flex items-center gap-1.5">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Synthesizing grounded answer...
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Stream Error Banner */}
                {streamError && (
                  <div className="p-3 border border-destructive/30 bg-destructive/10 text-destructive text-xs rounded-lg flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0" />
                      <span>{streamError}</span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleSendMessage(messages[messages.length - 1]?.content || "")}
                      className="text-xs h-6 px-2 gap-1"
                    >
                      <RotateCcw className="w-3 h-3" /> Retry
                    </Button>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </>
            )}
          </CardContent>

          {/* Input & Send Area */}
          <div className="p-3 border-t bg-card">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleSendMessage();
              }}
              className="flex gap-2 items-end"
            >
              <Textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder="Ask about medications, test results, diagnoses in patient records..."
                disabled={isStreaming}
                className="min-h-[44px] max-h-32 text-xs resize-none rounded-xl"
                rows={1}
              />

              <Button
                type="submit"
                disabled={!inputText.trim() || isStreaming}
                className="h-11 px-4 gap-1.5 rounded-xl shrink-0"
              >
                {isStreaming ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                <span className="hidden sm:inline">Send</span>
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}
