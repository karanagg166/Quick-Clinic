"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useUserStore } from "@/store/userStore";

export const useSocket = () => {
  const user = useUserStore((state) => state.user);
  const userId = user?.id;
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const fetchToken = useCallback(async (): Promise<{ token: string; socketUrl: string } | null> => {
    try {
      const res = await fetch("/api/socket/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
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
      queueMicrotask(() => {
        setSocket(null);
      });
      return;
    }

    let isMounted = true;

    const initSocket = async () => {
      const ticket = await fetchToken();
      if (!isMounted || !ticket) return;

      const socketUrl = ticket.socketUrl || process.env.NEXT_PUBLIC_SOCKET_URL;
      if (!socketUrl) return;

      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      const instance = io(socketUrl, {
        path: "/socket.io",
        auth: {
          token: ticket.token,
        },
        transports: ["websocket", "polling"],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 10,
        timeout: 10000,
      });

      socketRef.current = instance;

      instance.on("connect", () => {
        if (isMounted) setSocket(instance);
      });

      instance.on("connect_error", async (err: Error) => {
        if (!isMounted) return;
        // Refresh token if expired
        if (err.message && /token|auth|expired/i.test(err.message)) {
          const fresh = await fetchToken();
          if (fresh && socketRef.current) {
            socketRef.current.auth = { token: fresh.token };
            socketRef.current.connect();
          }
        }
      });

      instance.on("disconnect", () => {
        // Keep instance reference for reconnecting
      });

      if (isMounted) {
        setSocket(instance);
      }
    };

    initSocket();

    const handleOnline = () => {
      if (socketRef.current && !socketRef.current.connected) {
        socketRef.current.connect();
      } else if (!socketRef.current) {
        initSocket();
      }
    };

    window.addEventListener("online", handleOnline);

    return () => {
      isMounted = false;
      window.removeEventListener("online", handleOnline);
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
    };
  }, [userId, fetchToken]);

  return socket;
};
