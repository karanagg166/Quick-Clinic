'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader, Wifi, WifiOff, AlertCircle, RefreshCw } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { showToast } from '@/lib/toast';
import Link from 'next/link';

import { useUserStore } from '@/store/userStore';

export interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  createdAt: string;
  status?: 'pending' | 'sent' | 'failed';
  clientMessageId?: string;
}

interface ChatBarProps {
  doctorPatientRelationId: string;
  userId: string;
}

function renderFormattedMessage(text: string, isMe: boolean, currentRole?: string) {
  const pattern = /\[([^\]]+)\]\(([^)]+)\)|(https?:\/\/[^\s]+)|(\/(?:patient|doctor)\/[a-zA-Z0-9\-_/]+)/g;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    if (match[1] && match[2]) {
      const label = match[1];
      let url = match[2];
      const isInternal = url.startsWith('/');

      if (currentRole === 'DOCTOR' && url.startsWith('/patient/appointments/')) {
        url = url.replace('/patient/appointments/', '/doctor/appointments/');
      } else if (currentRole === 'PATIENT' && url.startsWith('/doctor/appointments/')) {
        url = url.replace('/doctor/appointments/', '/patient/appointments/');
      }

      const isCancelAction = /cancel/i.test(label) || /cancel/i.test(url);
      const isReviewAction = /review|rate/i.test(label) || /rating|review/i.test(url);
      const isFindOrBookAction = /find|select|book|doctor|slot/i.test(label) || /findDoctors|doctor\//i.test(url);
      const isManageAction = /manage|view|appointment/i.test(label);

      if (isInternal && (isCancelAction || isReviewAction || isFindOrBookAction || isManageAction)) {
        let buttonVariant: 'default' | 'destructive' | 'outline' | 'secondary' = 'default';
        let buttonClass = 'bg-primary text-primary-foreground hover:bg-primary/90';

        if (isCancelAction) {
          buttonVariant = 'destructive';
          buttonClass = 'bg-red-600 hover:bg-red-700 text-white';
        } else if (isReviewAction) {
          buttonClass = 'bg-amber-600 hover:bg-amber-700 text-white';
        } else if (isFindOrBookAction) {
          buttonClass = 'bg-teal-600 hover:bg-teal-700 text-white';
        } else if (isMe) {
          buttonClass = 'bg-white text-gray-900 hover:bg-gray-100';
        }

        elements.push(
          <span key={match.index} className="block my-2">
            <Link href={url}>
              <Button
                variant={buttonVariant}
                size="sm"
                className={`text-xs font-semibold px-3 py-1.5 shadow-xs transition active:scale-95 ${buttonClass}`}
              >
                {label}
              </Button>
            </Link>
          </span>
        );
      } else if (isInternal) {
        elements.push(
          <Link
            key={match.index}
            href={url}
            className={`font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity ${
              isMe ? 'text-white' : 'text-primary'
            }`}
          >
            {label}
          </Link>
        );
      } else {
        elements.push(
          <a
            key={match.index}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className={`font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity ${
              isMe ? 'text-white' : 'text-primary'
            }`}
          >
            {label}
          </a>
        );
      }
    } else if (match[3]) {
      const url = match[3];
      elements.push(
        <a
          key={match.index}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className={`font-semibold underline underline-offset-2 break-all hover:opacity-80 transition-opacity ${
            isMe ? 'text-white' : 'text-primary'
          }`}
        >
          {url}
        </a>
      );
    } else if (match[4]) {
      let route = match[4];
      if (currentRole === 'DOCTOR' && route.startsWith('/patient/appointments')) {
        route = route.replace('/patient/appointments', '/doctor/appointments');
      } else if (currentRole === 'PATIENT' && route.startsWith('/doctor/appointments')) {
        route = route.replace('/doctor/appointments', '/patient/appointments');
      }

      const isAppointmentsRoute = route.includes('/appointments');
      if (isAppointmentsRoute) {
        elements.push(
          <span key={match.index} className="block my-1.5">
            <Link href={route}>
              <Button
                variant={isMe ? 'secondary' : 'default'}
                size="sm"
                className="text-xs font-semibold px-3 py-1 shadow-xs"
              >
                📋 View Appointments
              </Button>
            </Link>
          </span>
        );
      } else {
        elements.push(
          <Link
            key={match.index}
            href={route}
            className={`inline-flex items-center gap-1 font-semibold underline underline-offset-2 px-1.5 py-0.5 rounded text-xs transition-colors ${
              isMe
                ? 'bg-white/20 text-white hover:bg-white/30'
                : 'bg-primary/15 text-primary hover:bg-primary/25'
            }`}
          >
            {route}
          </Link>
        );
      }
    }

    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

export default function ChatBar({ doctorPatientRelationId, userId }: ChatBarProps) {
  const currentRole = useUserStore((s) => s.user?.role);
  const currentUserName = useUserStore((s) => s.user?.name);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'offline'>('connecting');
  const [typingUser, setTypingUser] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper: merge messages without creating duplicates or discarding newer ones
  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const map = new Map<string, Message>();
      // Keep existing messages
      for (const msg of prev) {
        map.set(msg.id, msg);
        if (msg.clientMessageId) map.set(msg.clientMessageId, msg);
      }
      // Upsert incoming messages
      for (const msg of incoming) {
        const existing = map.get(msg.id) || (msg.clientMessageId ? map.get(msg.clientMessageId) : undefined);
        if (existing) {
          map.set(msg.id, { ...existing, ...msg, status: 'sent' });
        } else {
          map.set(msg.id, { ...msg, status: msg.status || 'sent' });
        }
      }
      // Return sorted by createdAt ascending
      return Array.from(map.values()).sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }, []);

  // 1. Fetch initial/recent messages via REST API
  const fetchMessagesFromAPI = useCallback(async () => {
    try {
      const res = await fetch(`/api/doctorpatientrelations/${doctorPatientRelationId}/chats?limit=50`);
      if (res.ok) {
        const data = await res.json();
        if (data?.chats && Array.isArray(data.chats)) {
          const formatted: Message[] = data.chats.map((c: any) => ({
            id: c.id,
            text: c.text,
            senderId: c.senderId,
            senderName: c.sender?.name || (c.senderId === userId ? currentUserName : undefined),
            senderRole: c.sender?.role,
            createdAt: c.createdAt,
            status: 'sent',
          }));
          mergeMessages(formatted);
        }
      }
    } catch (err) {
      console.warn('Error fetching chats via REST:', err);
    } finally {
      setLoading(false);
    }
  }, [doctorPatientRelationId, userId, currentUserName, mergeMessages]);

  useEffect(() => {
    fetchMessagesFromAPI();
  }, [fetchMessagesFromAPI]);

  // Request short-lived audience-bound socket ticket
  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch('/api/socket/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relationId: doctorPatientRelationId }),
        credentials: 'same-origin',
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.success && data?.token) {
        return { token: data.token, socketUrl: data.socketUrl };
      }
      return null;
    } catch {
      return null;
    }
  }, [doctorPatientRelationId]);

  // 2. Initialize authenticated Socket.IO connection
  useEffect(() => {
    let isMounted = true;
    let socketInstance: Socket | null = null;

    const setupSocket = async () => {
      setConnectionStatus('connecting');

      const ticket = await fetchTicket();
      if (!isMounted) return;

      if (!ticket) {
        setConnectionStatus('offline');
        setLoading(false);
        return;
      }

      const socketUrl = ticket.socketUrl || process.env.NEXT_PUBLIC_SOCKET_URL;
      if (!socketUrl) {
        setConnectionStatus('offline');
        setLoading(false);
        return;
      }

      socketInstance = io(socketUrl, {
        auth: {
          token: ticket.token,
          relationId: doctorPatientRelationId,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        timeout: 10000,
      });

      socketInstance.on('connect', () => {
        if (!isMounted) return;
        setConnectionStatus('connected');
        // Request latest messages upon connect / reconnect
        socketInstance?.emit('get_initial_messages', { page: 1, limit: 50 });
      });

      socketInstance.on('connected', () => {
        if (isMounted) setConnectionStatus('connected');
      });

      socketInstance.on('initial_messages', (data: { messages?: Message[] }) => {
        if (isMounted && data?.messages && Array.isArray(data.messages)) {
          mergeMessages(data.messages);
        }
        if (isMounted) setLoading(false);
      });

      socketInstance.on('new_message', (data: { message: Message }) => {
        if (isMounted && data?.message) {
          mergeMessages([data.message]);
        }
      });

      socketInstance.on('user_typing', (data: { userId: string; userName?: string }) => {
        if (isMounted && data.userId !== userId) {
          setTypingUser(data.userName || 'Someone');
          if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
          typingTimeoutRef.current = setTimeout(() => setTypingUser(null), 3000);
        }
      });

      socketInstance.on('disconnect', () => {
        if (isMounted) setConnectionStatus('offline');
      });

      socketInstance.on('connect_error', async (err: Error) => {
        if (!isMounted) return;
        setConnectionStatus('offline');
        setLoading(false);

        // If token error or ticket expired, obtain fresh ticket and reconnect
        if (err.message && /token|auth|expired/i.test(err.message)) {
          const fresh = await fetchTicket();
          if (fresh && socketInstance) {
            socketInstance.auth = {
              token: fresh.token,
              relationId: doctorPatientRelationId,
            };
            socketInstance.connect();
          }
        }
      });

      if (isMounted) {
        socketRef.current = socketInstance;
      }
    };

    setupSocket();

    const handleOnline = () => {
      if (socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      } else if (!socketRef.current) {
        setupSocket();
      }
    };

    window.addEventListener('online', handleOnline);

    return () => {
      isMounted = false;
      window.removeEventListener('online', handleOnline);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (socketInstance) {
        socketInstance.disconnect();
      }
      socketRef.current = null;
    };
  }, [doctorPatientRelationId, userId, fetchTicket, mergeMessages]);

  // Auto-scroll to bottom on message update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = '0px';
      const scrollHeight = textareaRef.current.scrollHeight;
      textareaRef.current.style.height = Math.min(scrollHeight, 120) + 'px';
    }
  }, [inputValue]);

  const handleTyping = () => {
    if (socketRef.current && socketRef.current.connected) {
      socketRef.current.emit('user_typing');
    }
  };

  // Reliable send message with typed acknowledgement and draft preservation
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || sending) return;

    if (text.length > 5000) {
      showToast.error('Message exceeds maximum limit of 5000 characters');
      return;
    }

    setSending(true);

    const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    const optimisticMessage: Message = {
      id: clientMessageId,
      clientMessageId,
      text,
      senderId: userId,
      senderName: currentUserName || 'Me',
      senderRole: currentRole || undefined,
      createdAt: new Date().toISOString(),
      status: 'pending',
    };

    // Append optimistic message
    setMessages((prev) => [...prev, optimisticMessage]);

    // Keep draft copy in memory; do not wipe until acknowledged
    const draftText = text;

    try {
      if (socketRef.current && socketRef.current.connected) {
        // Send via Socket with 5-second acknowledgement timeout
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            reject(new Error('Acknowledgement timed out'));
          }, 5000);

          socketRef.current?.emit(
            'send_message',
            { text: draftText, clientMessageId },
            (ack: { success: boolean; message?: Message; error?: string }) => {
              clearTimeout(timer);
              if (ack && ack.success && ack.message) {
                // Succeeded: update message status to sent and clear input draft
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === clientMessageId || m.clientMessageId === clientMessageId
                      ? { ...ack.message!, status: 'sent' }
                      : m
                  )
                );
                setInputValue('');
                resolve();
              } else {
                reject(new Error(ack?.error || 'Server rejected message'));
              }
            }
          );
        });
      } else {
        // Fallback: Send directly via REST API with idempotency key
        const res = await fetch(`/api/doctorpatientrelations/${doctorPatientRelationId}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: draftText,
            clientMessageId,
            senderId: userId,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.chat) {
            const canonical: Message = {
              id: data.chat.id,
              clientMessageId,
              text: data.chat.text,
              senderId: data.chat.senderId,
              senderName: data.chat.sender?.name || currentUserName || 'Me',
              senderRole: data.chat.sender?.role || currentRole,
              createdAt: data.chat.createdAt,
              status: 'sent',
            };
            setMessages((prev) =>
              prev.map((m) =>
                m.id === clientMessageId || m.clientMessageId === clientMessageId ? canonical : m
              )
            );
            setInputValue('');
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to send message via REST');
        }
      }
    } catch (err: any) {
      console.error('Send message error:', err);
      // Failed: mark message as failed and preserve input draft
      setMessages((prev) =>
        prev.map((m) =>
          m.id === clientMessageId || m.clientMessageId === clientMessageId
            ? { ...m, status: 'failed' }
            : m
        )
      );
      setInputValue(draftText);
      showToast.error(err?.message || 'Failed to send message. Draft preserved.');
    } finally {
      setSending(false);
    }
  };

  const handleRetry = (msg: Message) => {
    setInputValue(msg.text);
    setMessages((prev) => prev.filter((m) => m.id !== msg.id));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage({ preventDefault: () => {} } as React.FormEvent);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-10rem)] min-h-[480px] max-h-[760px] bg-background border rounded-2xl shadow-xs overflow-hidden">
      {/* Header */}
      <div className="border-b px-3.5 sm:px-6 py-3.5 sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg sm:text-xl font-semibold tracking-tight">Chat</h2>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">Secure conversation with your provider</p>
          </div>
          <Badge
            variant={connectionStatus === 'connected' ? 'default' : 'secondary'}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-xs shrink-0"
          >
            {connectionStatus === 'connected' ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-green-500" />
                <span className="hidden sm:inline">Live (Socket)</span>
                <span className="sm:hidden">Live</span>
              </>
            ) : connectionStatus === 'connecting' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
                <span className="hidden sm:inline">Connecting...</span>
                <span className="sm:hidden">Connecting</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="hidden sm:inline">Standard (REST)</span>
                <span className="sm:hidden">REST</span>
              </>
            )}
          </Badge>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-3.5 sm:px-6 py-4 sm:py-6 space-y-3.5 scroll-smooth">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader className="w-8 h-8 text-primary animate-spin mx-auto mb-3" />
              <p className="text-muted-foreground font-medium text-sm">Loading messages...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-3">
                <span className="text-2xl">💬</span>
              </div>
              <p className="text-foreground font-semibold text-base">No messages yet</p>
              <p className="text-xs text-muted-foreground mt-1">Start the conversation by sending a message below</p>
            </div>
          </div>
        ) : (
          messages.map((message) => {
            const isMe = message.senderId === userId;
            return (
              <div
                key={message.id}
                className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-xs transition-opacity ${
                    message.status === 'pending' ? 'opacity-70' : ''
                  } ${
                    message.status === 'failed' ? 'border-2 border-red-500 bg-red-50 dark:bg-red-950/20' : ''
                  } ${
                    isMe && message.status !== 'failed'
                      ? 'bg-primary text-primary-foreground rounded-br-xs'
                      : !isMe
                      ? 'bg-muted text-foreground rounded-bl-xs'
                      : 'text-foreground rounded-br-xs'
                  }`}
                >
                  {message.senderName && (
                    <p
                      className={`text-[11px] font-semibold mb-0.5 ${
                        isMe && message.status !== 'failed'
                          ? 'text-primary-foreground/80'
                          : 'text-muted-foreground'
                      }`}
                    >
                      {message.senderName}
                    </p>
                  )}
                  <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {renderFormattedMessage(message.text, isMe, currentRole)}
                  </div>
                  <div
                    className={`flex items-center justify-end gap-1.5 mt-1 text-[10px] ${
                      isMe && message.status !== 'failed'
                        ? 'text-primary-foreground/70'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {message.status === 'pending' && (
                      <span className="flex items-center gap-1 text-amber-500">
                        <Loader className="w-3 h-3 animate-spin" /> Sending...
                      </span>
                    )}
                    {message.status === 'failed' && (
                      <button
                        type="button"
                        onClick={() => handleRetry(message)}
                        className="flex items-center gap-1 text-red-600 font-semibold hover:underline cursor-pointer"
                      >
                        <AlertCircle className="w-3 h-3" /> Failed to send (Click to retry)
                      </button>
                    )}
                    {(!message.status || message.status === 'sent') && (
                      <span>
                        {new Date(message.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* Typing Indicator */}
        {typingUser && (
          <div className="flex justify-start">
            <div className="bg-muted text-foreground px-4 py-2 rounded-2xl rounded-bl-xs shadow-xs">
              <p className="text-xs text-muted-foreground mb-1">{typingUser} is typing...</p>
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" />
                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.2s]" />
                <div className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce [animation-delay:0.4s]" />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="border-t px-3.5 sm:px-6 py-3 sticky bottom-0 bg-background">
        <form onSubmit={handleSendMessage} className="flex gap-2 sm:gap-3">
          <Textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              handleTyping();
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message (Shift+Enter for newline)..."
            disabled={sending}
            rows={1}
            className="flex-1 resize-none rounded-xl text-sm"
          />
          <Button
            type="submit"
            disabled={sending || !inputValue.trim()}
            size="icon"
            className="rounded-xl shrink-0"
          >
            {sending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
