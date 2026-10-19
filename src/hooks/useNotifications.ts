'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useUserStore } from '@/store/userStore';

interface Notification {
  id: string;
  message: string;
  actionHref: string | null;
  actionLabel: string | null;
  createdAt: string;
  isRead: boolean;
}

export function useNotifications() {
  const user = useUserStore((state) => state.user);
  const userId = user?.id;
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSocketToken = useCallback(async (): Promise<{ token: string; socketUrl: string } | null> => {
    try {
      const res = await fetch('/api/socket/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
  }, []);

  useEffect(() => {
    if (!userId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setIsConnected(false);
      setNotifications([]);
      return;
    }

    let isMounted = true;

    const fetchPersistedNotifications = async () => {
      try {
        const res = await fetch(`/api/user/${userId}/notification`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && isMounted) {
            setNotifications((prev) => {
              const prevMap = new Map(prev.map((n) => [n.id, n]));
              for (const item of list) {
                if (!prevMap.has(item.id)) {
                  prevMap.set(item.id, {
                    id: item.id,
                    message: item.message,
                    actionHref: item.actionHref ?? null,
                    actionLabel: item.actionLabel ?? null,
                    createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(item.createdAt).toISOString(),
                    isRead: Boolean(item.isRead),
                  });
                }
              }
              return Array.from(prevMap.values()).sort(
                (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
              );
            });
          }
        }
      } catch (err) {
        console.warn('Failed to load persisted notifications:', err);
      }
    };

    fetchPersistedNotifications();

    const connectSocket = async () => {
      const ticket = await fetchSocketToken();
      if (!isMounted || !ticket) {
        return;
      }

      const socketUrl = ticket.socketUrl || process.env.NEXT_PUBLIC_SOCKET_URL;
      if (!socketUrl) {
        // In production without socket URL, do not fallback to visitor's localhost
        return;
      }

      // Disconnect any existing socket before opening a new authenticated one
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      const socket = io(socketUrl, {
        auth: {
          token: ticket.token,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        timeout: 10000,
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        if (isMounted) {
          setIsConnected(true);
          fetchPersistedNotifications();
        }
      });

      socket.on('notification_connected', () => {
        if (isMounted) {
          setIsConnected(true);
          fetchPersistedNotifications();
        }
      });

      socket.on('new_notification', (data: { notification: Notification }) => {
        if (isMounted && data?.notification) {
          setNotifications((prev) => {
            const exists = prev.some((n) => n.id === data.notification.id);
            return exists ? prev : [data.notification, ...prev];
          });
        }
      });

      socket.on('disconnect', () => {
        if (isMounted) setIsConnected(false);
      });

      socket.on('connect_error', async (err: Error) => {
        if (!isMounted) return;
        setIsConnected(false);

        // If authentication failed (e.g. ticket expired), re-fetch ticket and retry
        if (err.message && /token|auth|expired/i.test(err.message)) {
          const freshTicket = await fetchSocketToken();
          if (freshTicket && socketRef.current) {
            socketRef.current.auth = { token: freshTicket.token };
            socketRef.current.connect();
          }
        }
      });
    };

    connectSocket();

    const handleOnline = () => {
      if (socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      } else if (!socketRef.current) {
        connectSocket();
      }
    };

    window.addEventListener('online', handleOnline);

    return () => {
      isMounted = false;
      window.removeEventListener('online', handleOnline);
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [userId, fetchSocketToken]);

  return {
    notifications,
    isConnected,
  };
}
