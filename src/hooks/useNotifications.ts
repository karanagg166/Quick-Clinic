'use client';

import { useEffect, useState, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useUserStore } from '@/store/userStore';

interface Notification {
  id: string;
  message: string;
  createdAt: string;
  isRead: boolean;
}

export function useNotifications() {
  const userId = useUserStore((state) => state.user?.id);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!userId) return;

    // Clean up existing connection if any
    if (socketRef.current) {
      console.log('Cleaning up existing notification socket');
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
    
    console.log('Connecting to Socket.IO for notifications:', socketUrl);
    
    const socket = io(socketUrl, {
      auth: {
        userId, // Only userId, no relationId for notifications
      },
      transports: ['polling'], // Use polling only to avoid WebSocket upgrade issues
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      timeout: 20000,
      forceNew: true, // Force new connection to avoid reuse issues
      upgrade: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Notifications socket connected');
      setIsConnected(true);
    });

    socket.on('notification_connected', (data: { message: string; userId: string; userRole: string; userName: string }) => {
      console.log('Notification connection confirmed:', data);
    });

    socket.on('new_notification', (data: { notification: Notification }) => {
      console.log('Received new notification:', data.notification);
      setNotifications((prev) => [data.notification, ...prev]);
    });

    socket.on('disconnect', () => {
      console.log('Notifications socket disconnected');
      setIsConnected(false);
    });

    socket.on('connect_error', (error: Error) => {
      console.error('Notification socket connection error:', error.message);
      setIsConnected(false);
    });

    socket.on('error', (error: Error) => {
      console.error('Notification socket error:', error);
    });

    return () => {
      console.log('Cleaning up notification socket');
      socket.disconnect();
      socketRef.current = null;
    };
  }, [userId]);

  return {
    notifications,
    isConnected,
  };
}

