'use client';

import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { useUserStore } from '@/store/userStore';

export interface NotificationItem {
  id: string;
  message: string;
  actionHref?: string | null;
  actionLabel?: string | null;
  createdAt: string;
  isRead: boolean;
}

// Module-level singleton state to avoid duplicate notification connections across components
let activeUserId: string | null = null;
let sharedSocket: Socket | null = null;
let cachedNotifications: NotificationItem[] = [];
let isSocketConnected = false;
let consecutiveAuthFailures = 0;
let inFlightTokenPromise: Promise<{ token: string; socketUrl: string } | null> | null = null;

const notificationSubscribers = new Set<(items: NotificationItem[]) => void>();
const connectionSubscribers = new Set<(connected: boolean) => void>();

function notifyAllSubscribers() {
  for (const sub of notificationSubscribers) {
    sub([...cachedNotifications]);
  }
}

function notifyConnectionSubscribers() {
  for (const sub of connectionSubscribers) {
    sub(isSocketConnected);
  }
}

// Bounded, single-flight token fetcher
async function fetchSingleFlightToken(): Promise<{ token: string; socketUrl: string } | null> {
  if (inFlightTokenPromise) {
    return inFlightTokenPromise;
  }
  if (consecutiveAuthFailures >= 3) {
    console.warn('[NotificationSocket] Max auth retry attempts reached. Pausing auth refresh.');
    return null;
  }

  inFlightTokenPromise = (async () => {
    try {
      const res = await fetch('/api/socket/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
      });
      if (!res.ok) {
        consecutiveAuthFailures++;
        return null;
      }
      const data = await res.json();
      if (data?.success && data?.token) {
        consecutiveAuthFailures = 0;
        return { token: data.token, socketUrl: data.socketUrl };
      }
      consecutiveAuthFailures++;
      return null;
    } catch {
      consecutiveAuthFailures++;
      return null;
    } finally {
      inFlightTokenPromise = null;
    }
  })();

  return inFlightTokenPromise;
}

async function fetchPersistedNotifications(userId: string) {
  try {
    const res = await fetch(`/api/user/${userId}/notification`);
    if (res.ok) {
      const list = await res.json();
      if (Array.isArray(list)) {
        const prevMap = new Map(cachedNotifications.map((n) => [n.id, n]));
        for (const item of list) {
          prevMap.set(item.id, {
            id: item.id,
            message: item.message,
            actionHref: item.actionHref ?? null,
            actionLabel: item.actionLabel ?? null,
            createdAt: typeof item.createdAt === 'string' ? item.createdAt : new Date(item.createdAt).toISOString(),
            isRead: Boolean(item.isRead),
          });
        }
        cachedNotifications = Array.from(prevMap.values()).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        notifyAllSubscribers();
      }
    }
  } catch (err) {
    console.warn('Failed to load persisted notifications:', err);
  }
}

async function initNotificationSocket(userId: string) {
  if (sharedSocket && activeUserId === userId && sharedSocket.connected) {
    return;
  }

  if (activeUserId !== userId && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    cachedNotifications = [];
    isSocketConnected = false;
    consecutiveAuthFailures = 0;
    notifyAllSubscribers();
    notifyConnectionSubscribers();
  }

  activeUserId = userId;
  await fetchPersistedNotifications(userId);

  const ticket = await fetchSingleFlightToken();
  if (!ticket || activeUserId !== userId) return;

  const socketUrl = ticket.socketUrl || process.env.NEXT_PUBLIC_SOCKET_URL;
  if (!socketUrl) return;

  if (sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
  }

  const socket = io(socketUrl, {
    path: '/socket.io',
    auth: { token: ticket.token },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 10,
    timeout: 10000,
  });

  sharedSocket = socket;

  socket.on('connect', () => {
    isSocketConnected = true;
    notifyConnectionSubscribers();
    if (activeUserId) void fetchPersistedNotifications(activeUserId);
  });

  socket.on('notification_connected', () => {
    isSocketConnected = true;
    notifyConnectionSubscribers();
    if (activeUserId) void fetchPersistedNotifications(activeUserId);
  });

  socket.on('new_notification', (data: { notification: NotificationItem }) => {
    if (data?.notification) {
      const exists = cachedNotifications.some((n) => n.id === data.notification.id);
      if (!exists) {
        cachedNotifications = [data.notification, ...cachedNotifications];
        notifyAllSubscribers();
      }
    }
  });

  socket.on('disconnect', () => {
    isSocketConnected = false;
    notifyConnectionSubscribers();
  });

  socket.on('auth_expired', async () => {
    isSocketConnected = false;
    notifyConnectionSubscribers();
    const fresh = await fetchSingleFlightToken();
    if (fresh && sharedSocket) {
      sharedSocket.auth = { token: fresh.token };
      sharedSocket.connect();
    }
  });

  socket.on('account_revoked', () => {
    if (sharedSocket) {
      sharedSocket.disconnect();
      sharedSocket = null;
    }
    cachedNotifications = [];
    isSocketConnected = false;
    notifyAllSubscribers();
    notifyConnectionSubscribers();
  });

  socket.on('connect_error', async (err: Error) => {
    isSocketConnected = false;
    notifyConnectionSubscribers();
    if (err.message && /token|auth|expired/i.test(err.message)) {
      const fresh = await fetchSingleFlightToken();
      if (fresh && sharedSocket) {
        sharedSocket.auth = { token: fresh.token };
        sharedSocket.connect();
      }
    }
  });
}

export function useNotifications() {
  const user = useUserStore((state) => state.user);
  const userId = user?.id;
  const [notifications, setNotifications] = useState<NotificationItem[]>(cachedNotifications);
  const [isConnected, setIsConnected] = useState<boolean>(isSocketConnected);

  useEffect(() => {
    if (!userId) {
      if (sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
      }
      activeUserId = null;
      cachedNotifications = [];
      isSocketConnected = false;
      setNotifications([]);
      setIsConnected(false);
      return;
    }

    notificationSubscribers.add(setNotifications);
    connectionSubscribers.add(setIsConnected);

    // Sync initial state
    setNotifications([...cachedNotifications]);
    setIsConnected(isSocketConnected);

    void initNotificationSocket(userId);

    const handleOnline = () => {
      if (sharedSocket && !sharedSocket.connected) {
        sharedSocket.connect();
      } else if (!sharedSocket && activeUserId) {
        void initNotificationSocket(activeUserId);
      }
    };

    window.addEventListener('online', handleOnline);

    return () => {
      notificationSubscribers.delete(setNotifications);
      connectionSubscribers.delete(setIsConnected);
      window.removeEventListener('online', handleOnline);
    };
  }, [userId]);

  return {
    notifications,
    isConnected,
  };
}
