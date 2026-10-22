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
  isRead?: boolean;
}

interface ChatBarProps {
  doctorPatientRelationId: string;
  userId: string;
}

export function reconcileMessages(prev: Message[], incoming: Message[]): Message[] {
  const result = [...prev];

  for (const msg of incoming) {
    const existingIdx = result.findIndex(
      (m) =>
        m.id === msg.id ||
        (msg.clientMessageId && m.clientMessageId === msg.clientMessageId) ||
        (msg.clientMessageId && m.id === msg.clientMessageId) ||
        (m.clientMessageId && m.clientMessageId === msg.id)
    );

    if (existingIdx !== -1) {
      const existing = result[existingIdx];
      const preferredId =
        msg.status === 'sent' && msg.id
          ? msg.id
          : existing.status === 'sent' && existing.id
          ? existing.id
          : msg.id || existing.id;

      result[existingIdx] = {
        ...existing,
        ...msg,
        id: preferredId,
        clientMessageId: msg.clientMessageId || existing.clientMessageId,
        status:
          msg.status === 'failed' || existing.status === 'failed'
            ? msg.status === 'sent' || existing.status === 'sent'
              ? 'sent'
              : 'failed'
            : msg.status || 'sent',
      };
    } else {
      result.push({
        ...msg,
        status: msg.status || 'sent',
      });
    }
  }

  // Deduplicate in case prev already had partial duplicates
  const deduplicated: Message[] = [];
  for (const msg of result) {
    const dupIdx = deduplicated.findIndex(
      (m) =>
        m.id === msg.id ||
        (msg.clientMessageId && m.clientMessageId === msg.clientMessageId) ||
        (msg.clientMessageId && m.id === msg.clientMessageId) ||
        (m.clientMessageId && m.clientMessageId === msg.id)
    );

    if (dupIdx !== -1) {
      const existing = deduplicated[dupIdx];
      const preferredId =
        msg.status === 'sent' && msg.id
          ? msg.id
          : existing.status === 'sent' && existing.id
          ? existing.id
          : msg.id || existing.id;
      deduplicated[dupIdx] = {
        ...existing,
        ...msg,
        id: preferredId,
        clientMessageId: msg.clientMessageId || existing.clientMessageId,
        status:
          msg.status === 'sent' || existing.status === 'sent'
            ? 'sent'
            : msg.status || existing.status || 'sent',
      };
    } else {
      deduplicated.push(msg);
    }
  }

  return deduplicated.sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
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

export function createOptimisticMessage(
  text: string,
  userId: string,
  userName?: string,
  userRole?: string
): Message {
  const clientMessageId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  return {
    id: clientMessageId,
    clientMessageId,
    text,
    senderId: userId,
    senderName: userName || 'Me',
    senderRole: userRole,
    createdAt: new Date().toISOString(),
    status: 'pending',
  };
}

export default function ChatBar({ doctorPatientRelationId, userId }: ChatBarProps) {
  const currentRole = useUserStore((s) => s.user?.role);
  const currentUserName = useUserStore((s) => s.user?.name);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'reconnecting' | 'offline' | 'recovery-failed'>('connecting');
  const [typingUser, setTypingUser] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<Message[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const socketRef = useRef<Socket | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const ackTimersRef = useRef<Set<NodeJS.Timeout>>(new Set());
  const inFlightTicketRef = useRef<Promise<{ token: string; socketUrl: string } | null> | null>(null);
  const authFailureCountRef = useRef<number>(0);

  // Keep messagesRef in sync with messages state
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Helper: merge messages without creating duplicates or discarding newer ones
  const mergeMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => reconcileMessages(prev, incoming));
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
            clientMessageId: c.clientMessageId,
            text: c.text,
            senderId: c.senderId,
            senderName: c.sender?.name || (c.senderId === userId ? currentUserName : undefined),
            senderRole: c.sender?.role,
            createdAt: c.createdAt,
            status: 'sent',
            isRead: Boolean(c.isRead),
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

  // Request short-lived audience-bound socket ticket through bounded, single-flight requests
  const fetchTicket = useCallback(async () => {
    if (inFlightTicketRef.current) {
      return inFlightTicketRef.current;
    }
    if (authFailureCountRef.current >= 3) {
      console.warn('[ChatBar] Max auth refresh retries reached');
      return null;
    }

    inFlightTicketRef.current = (async () => {
      try {
        const res = await fetch('/api/socket/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ relationId: doctorPatientRelationId }),
          credentials: 'same-origin',
        });
        if (!res.ok) {
          authFailureCountRef.current++;
          return null;
        }
        const data = await res.json();
        if (data?.success && data?.token) {
          authFailureCountRef.current = 0;
          return { token: data.token, socketUrl: data.socketUrl };
        }
        authFailureCountRef.current++;
        return null;
      } catch {
        authFailureCountRef.current++;
        return null;
      } finally {
        inFlightTicketRef.current = null;
      }
    })();

    return inFlightTicketRef.current;
  }, [doctorPatientRelationId]);

  // Visibility-aware read receipts helper: only emits when tab is actively visible
  const markVisibleUnread = useCallback((sock: Socket | null) => {
    if (!sock || !sock.connected) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    const currentList = messagesRef.current;
    const unreadFromCounterparty = currentList.filter(
      (m) => m.senderId !== userId && !m.isRead && m.id && m.status !== 'pending' && m.status !== 'failed'
    );
    if (unreadFromCounterparty.length > 0) {
      const latest = unreadFromCounterparty[unreadFromCounterparty.length - 1];
      sock.emit('mark_as_read', { messageId: latest.id });
    }
  }, [userId]);

  // 2. Initialize authenticated Socket.IO connection
  useEffect(() => {
    if (!userId) {
      setMessages([]);
      setConnectionStatus('offline');
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      return;
    }

    let isMounted = true;
    let socketInstance: Socket | null = null;

    const setupSocket = async (isReconnect = false) => {
      setConnectionStatus(isReconnect ? 'reconnecting' : 'connecting');

      const ticket = await fetchTicket();
      if (!isMounted) return;

      if (!ticket) {
        setConnectionStatus(authFailureCountRef.current >= 3 ? 'recovery-failed' : 'offline');
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
        path: '/socket.io',
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
        authFailureCountRef.current = 0;

        // Synchronize and recover missed messages across disconnect gap
        const currentList = messagesRef.current;
        if (currentList.length > 0) {
          const lastMsg = currentList[currentList.length - 1];
          socketInstance?.emit('sync_messages', {
            since: lastMsg.createdAt,
            lastMessageId: lastMsg.id,
            limit: 100,
          });
        } else {
          socketInstance?.emit('get_initial_messages', { page: 1, limit: 50 });
        }
      });

      socketInstance.on('connected', () => {
        if (isMounted) setConnectionStatus('connected');
      });

      socketInstance.on('initial_messages', (data: { messages?: Message[] }) => {
        if (isMounted && data?.messages && Array.isArray(data.messages)) {
          mergeMessages(data.messages);
          markVisibleUnread(socketInstance);
        }
        if (isMounted) setLoading(false);
      });

      socketInstance.on('sync_messages_result', (data: { messages?: Message[] }) => {
        if (isMounted && data?.messages && Array.isArray(data.messages)) {
          mergeMessages(data.messages);
          markVisibleUnread(socketInstance);
        }
      });

      socketInstance.on('new_message', (data: { message: Message }) => {
        if (isMounted && data?.message) {
          mergeMessages([data.message]);
          if (data.message.senderId !== userId && data.message.id && data.message.status !== 'pending' && data.message.status !== 'failed') {
            if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
              socketInstance?.emit('mark_as_read', { messageId: data.message.id });
            }
          }
        }
      });

      socketInstance.on('message_read', (data: { messageId: string; readBy?: string }) => {
        if (isMounted && data?.messageId) {
          setMessages((prev) => {
            const targetIdx = prev.findIndex(
              (m) => m.id === data.messageId || m.clientMessageId === data.messageId
            );
            if (targetIdx !== -1) {
              const targetTime = new Date(prev[targetIdx].createdAt).getTime();
              return prev.map((m) =>
                new Date(m.createdAt).getTime() <= targetTime ? { ...m, isRead: true } : m
              );
            }
            return prev.map((m) =>
              m.id === data.messageId || m.clientMessageId === data.messageId
                ? { ...m, isRead: true }
                : m
            );
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

      socketInstance.on('user_stop_typing', (data: { userId: string }) => {
        if (isMounted && data.userId !== userId) {
          setTypingUser(null);
        }
      });

      socketInstance.on('disconnect', () => {
        if (isMounted) setConnectionStatus('offline');
      });

      socketInstance.on('auth_expired', async () => {
        if (!isMounted) return;
        setConnectionStatus('reconnecting');
        const fresh = await fetchTicket();
        if (fresh && socketInstance) {
          socketInstance.auth = {
            token: fresh.token,
            relationId: doctorPatientRelationId,
          };
          socketInstance.connect();
        } else {
          setConnectionStatus('recovery-failed');
        }
      });

      socketInstance.on('account_revoked', () => {
        if (isMounted) {
          setConnectionStatus('offline');
          setMessages([]);
        }
        if (socketInstance) socketInstance.disconnect();
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
      if (typeof window !== 'undefined') {
        (window as any).__quickClinicChatSocket = socketInstance;
      }
      }
    };

    setupSocket();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        markVisibleUnread(socketRef.current);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    const handleOnline = () => {
      if (socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      } else if (!socketRef.current) {
        setupSocket(true);
      }
    };

    window.addEventListener('online', handleOnline);

    const ackTimers = ackTimersRef.current;

    return () => {
      isMounted = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      ackTimers.forEach((t) => clearTimeout(t));
      ackTimers.clear();
      if (socketInstance) {
        socketInstance.removeAllListeners();
        socketInstance.disconnect();
      }
      socketRef.current = null;
    };
  }, [doctorPatientRelationId, userId, fetchTicket, mergeMessages, markVisibleUnread]);

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

  // Reusable send dispatcher preserving stable clientMessageId across retries and fallbacks
  const dispatchSendMessage = async (text: string, clientMessageId: string) => {
    setSending(true);
    let delivered = false;

    try {
      if (socketRef.current && socketRef.current.connected) {
        // Send via Socket with 5-second acknowledgement timeout
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            ackTimersRef.current.delete(timer);
            reject(new Error('Acknowledgement timed out'));
          }, 5000);
          ackTimersRef.current.add(timer);

          socketRef.current?.emit(
            'send_message',
            { text, clientMessageId },
            (ack: { success: boolean; message?: Message; error?: string }) => {
              clearTimeout(timer);
              ackTimersRef.current.delete(timer);
              if (ack && ack.success && ack.message) {
                mergeMessages([{ ...ack.message, status: 'sent' }]);
                delivered = true;
                resolve();
              } else {
                reject(new Error(ack?.error || 'Server rejected message'));
              }
            }
          );
        });
      } else {
        // Direct REST fallback
        const res = await fetch(`/api/doctorpatientrelations/${doctorPatientRelationId}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            clientMessageId,
            senderId: userId,
          }),
        });

        if (res.ok) {
          const data = await res.json();
          if (data?.chat) {
            const canonical: Message = {
              id: data.chat.id,
              clientMessageId: data.chat.clientMessageId || clientMessageId,
              text: data.chat.text,
              senderId: data.chat.senderId,
              senderName: data.chat.sender?.name || currentUserName || 'Me',
              senderRole: data.chat.sender?.role || currentRole,
              createdAt: data.chat.createdAt,
              status: 'sent',
            };
            mergeMessages([canonical]);
            delivered = true;
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Failed to send message via REST');
        }
      }
    } catch (primaryErr: any) {
      console.warn('Primary send failed, attempting REST retry fallback:', primaryErr?.message);
      // If primary send (socket) timed out or failed, attempt immediate REST fallback
      try {
        const fallbackRes = await fetch(`/api/doctorpatientrelations/${doctorPatientRelationId}/chats`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            clientMessageId,
            senderId: userId,
          }),
        });

        if (fallbackRes.ok) {
          const data = await fallbackRes.json();
          if (data?.chat) {
            const canonical: Message = {
              id: data.chat.id,
              clientMessageId: data.chat.clientMessageId || clientMessageId,
              text: data.chat.text,
              senderId: data.chat.senderId,
              senderName: data.chat.sender?.name || currentUserName || 'Me',
              senderRole: data.chat.sender?.role || currentRole,
              createdAt: data.chat.createdAt,
              status: 'sent',
            };
            mergeMessages([canonical]);
            delivered = true;
          }
        }
      } catch {
        // Fallback also failed
      }
    } finally {
      setSending(false);
      if (!delivered) {
        // Mark message as failed; composer input is preserved intact
        setMessages((prev) =>
          prev.map((m) =>
            m.id === clientMessageId || m.clientMessageId === clientMessageId
              ? { ...m, status: 'failed' }
              : m
          )
        );
        showToast.error('Message failed to send. You can click retry to resend.');
      }
    }
  };

  // Reliable send message: generates stable ID, optimistic insert, and clears composer immediately
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = inputValue.trim();
    if (!text || sending) return;

    if (text.length > 5000) {
      showToast.error('Message exceeds maximum limit of 5000 characters');
      return;
    }

    // Immediately clear input so user can type the next message without waiting
    setInputValue('');

    const optimisticMessage = createOptimisticMessage(
      text,
      userId,
      currentUserName,
      currentRole || undefined
    );

    // Append optimistic message
    mergeMessages([optimisticMessage]);

    await dispatchSendMessage(text, optimisticMessage.clientMessageId!);
  };

  // Retrying resends the original message payload and ID WITHOUT deleting an unrelated composer draft
  const handleRetry = (msg: Message) => {
    const stableId = msg.clientMessageId || msg.id;
    // Mark status back to pending
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msg.id || m.clientMessageId === stableId ? { ...m, status: 'pending' } : m
      )
    );
    // Dispatch with the exact same clientMessageId and payload
    dispatchSendMessage(msg.text, stableId);
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
            variant={connectionStatus === 'connected' ? 'default' : connectionStatus === 'recovery-failed' ? 'destructive' : 'secondary'}
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
            ) : connectionStatus === 'reconnecting' ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-amber-500" />
                <span className="hidden sm:inline">Reconnecting...</span>
                <span className="sm:hidden">Reconnecting</span>
              </>
            ) : connectionStatus === 'recovery-failed' ? (
              <>
                <AlertCircle className="w-3.5 h-3.5 text-white" />
                <span className="hidden sm:inline">Recovery Failed</span>
                <span className="sm:hidden">Failed</span>
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
                      <span className="flex items-center gap-1">
                        <span>
                          {new Date(message.createdAt).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {isMe && message.isRead && (
                          <span className="text-[10px] text-primary-foreground/90 font-medium ml-0.5">
                            ✓ Read
                          </span>
                        )}
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
