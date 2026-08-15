'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, Loader, Wifi, WifiOff } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { showToast } from '@/lib/toast';
import Link from 'next/link';

import { useUserStore } from '@/store/userStore';

interface Message {
  id: string;
  text: string;
  senderId: string;
  senderName?: string;
  senderRole?: string;
  createdAt: string;
}

interface ChatBarProps {
  doctorPatientRelationId: string;
  userId: string;
}

function renderFormattedMessage(text: string, isMe: boolean, currentRole?: string) {
  // Regex to match URLs, internal routes (/patient/..., /doctor/...), or markdown links [label](url)
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
      
      // Auto-adapt route if logged-in user is doctor vs patient
      if (currentRole === 'DOCTOR' && url.startsWith('/patient/appointments/')) {
        url = url.replace('/patient/appointments/', '/doctor/appointments/');
      } else if (currentRole === 'PATIENT' && url.startsWith('/doctor/appointments/')) {
        url = url.replace('/doctor/appointments/', '/patient/appointments/');
      }

      const isCancelAction = /cancel/i.test(label) || /cancel/i.test(url);
      const isManageAction = /manage|view|appointment|review|rate/i.test(label);

      if (isInternal && (isCancelAction || isManageAction)) {
        elements.push(
          <span key={match.index} className="block my-2">
            <Link href={url}>
              <Button
                variant={isCancelAction ? "destructive" : "default"}
                size="sm"
                className={`text-xs font-semibold px-3 py-1.5 shadow-sm transition active:scale-95 ${
                  isCancelAction
                    ? 'bg-red-600 hover:bg-red-700 text-white'
                    : isMe
                    ? 'bg-white text-gray-900 hover:bg-gray-100'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                }`}
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
                variant={isMe ? "secondary" : "default"}
                size="sm"
                className="text-xs font-semibold px-3 py-1 shadow-sm"
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
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 1. Fetch initial messages via REST API for guaranteed reliability
  const fetchMessagesFromAPI = useCallback(async () => {
    try {
      const res = await fetch(`/api/doctorpatientrelations/${doctorPatientRelationId}/chats?limit=50`);
      if (res.ok) {
        const data = await res.json();
        if (data?.chats && Array.isArray(data.chats)) {
          setMessages(data.chats);
        }
      }
    } catch {
      // Ignore network errors on chat history fetch
    } finally {
      setLoading(false);
    }
  }, [doctorPatientRelationId]);

  useEffect(() => {
    fetchMessagesFromAPI();
  }, [fetchMessagesFromAPI]);

  // 2. Initialize Socket.io connection with pre-flight check to prevent unhandled WebSocket errors
  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
    let isMounted = true;
    let socketInstance: Socket | null = null;

    const setupSocket = async () => {
      try {
        // Pre-flight health check to verify socket server is running
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);

        const healthRes = await fetch(`${socketUrl}/health`, {
          method: 'GET',
          signal: controller.signal,
        }).catch(() => null);

        clearTimeout(timeoutId);

        if (!healthRes || !healthRes.ok || !isMounted) {
          // Socket server is offline - stay in standard REST mode
          if (isMounted) {
            setIsConnected(false);
            setLoading(false);
          }
          return;
        }

        // Server is reachable, initiate socket connection
        socketInstance = io(socketUrl, {
          auth: {
            relationId: doctorPatientRelationId,
            userId,
          },
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionDelay: 2000,
          reconnectionDelayMax: 10000,
          reconnectionAttempts: 3,
          timeout: 4000,
        });

        socketInstance.on('connect', () => {
          if (isMounted) {
            setIsConnected(true);
            socketInstance?.emit('get_initial_messages', { page: 1, limit: 50 });
          }
        });

        socketInstance.on('initial_messages', (data: { messages?: Message[] }) => {
          if (isMounted && data?.messages && Array.isArray(data.messages)) {
            setMessages(data.messages);
          }
          if (isMounted) setLoading(false);
        });

        socketInstance.on('new_message', (data: { message: Message }) => {
          if (isMounted && data?.message) {
            setMessages((prev) => {
              const isDuplicate = prev.some((msg) => msg.id === data.message.id);
              return isDuplicate ? prev : [...prev, data.message];
            });
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
          if (isMounted) setIsConnected(false);
        });

        socketInstance.on('connect_error', () => {
          if (isMounted) {
            setIsConnected(false);
            setLoading(false);
          }
        });

        if (isMounted) {
          socketRef.current = socketInstance;
        }
      } catch {
        if (isMounted) {
          setIsConnected(false);
          setLoading(false);
        }
      }
    };

    setupSocket();

    return () => {
      isMounted = false;
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, [doctorPatientRelationId, userId]);

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

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || sending) return;

    setSending(true);

    try {
      // If socket is active, send via Socket
      if (socketRef.current && socketRef.current.connected) {
        socketRef.current.emit('send_message', { text });
        setInputValue('');
      } else {
        // Fallback: Send directly via REST API
        const res = await fetch(`/api/doctorpatientrelations/${doctorPatientRelationId}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            senderId: userId,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.chat) {
            setMessages((prev) => [...prev, data.chat]);
          }
          setInputValue('');
        } else {
          const errorData = await res.json();
          showToast.error(errorData.error || 'Failed to send message');
        }
      }
    } catch (err) {
      console.error('Error sending message:', err);
      showToast.error('Failed to send message. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage({ preventDefault: () => {} } as unknown as React.FormEvent);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <div className="border-b px-6 py-4 sticky top-0 z-10 bg-background/95 backdrop-blur">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Chat</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Secure conversation with your provider</p>
          </div>
          <Badge
            variant={isConnected ? "default" : "secondary"}
            className="flex items-center gap-1.5 px-3 py-1"
          >
            {isConnected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-green-500" />
                <span>Live Socket</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-muted-foreground" />
                <span>Standard (REST)</span>
              </>
            )}
          </Badge>
        </div>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-4 scroll-smooth">
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
                  className={`max-w-[75%] px-4 py-2.5 rounded-2xl shadow-xs ${
                    isMe
                      ? 'bg-primary text-primary-foreground rounded-br-xs'
                      : 'bg-muted text-foreground rounded-bl-xs'
                  }`}
                >
                  {message.senderName && (
                    <p className={`text-[11px] font-semibold mb-0.5 ${
                      isMe ? 'text-primary-foreground/80' : 'text-muted-foreground'
                    }`}>
                      {message.senderName}
                    </p>
                  )}
                  <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
                    {renderFormattedMessage(message.text, isMe, currentRole)}
                  </div>
                  <p className={`text-[10px] mt-1 text-right ${
                    isMe ? 'text-primary-foreground/70' : 'text-muted-foreground'
                  }`}>
                    {new Date(message.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
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
      <div className="border-t px-6 py-3 sticky bottom-0 bg-background">
        <form onSubmit={handleSendMessage} className="flex gap-3">
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
            {sending ? (
              <Loader className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </form>
      </div>
    </div>
  );
}
