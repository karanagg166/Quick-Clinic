"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useUserStore } from "@/store/userStore";

export const useSocket = () => {
  const user = useUserStore((state) => state.user);
  const userId = user?.id;
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const authFailureCountRef = useRef<number>(0);
  const inFlightTokenRef = useRef<Promise<{ token: string; socketUrl: string } | null> | null>(null);

  const fetchToken = useCallback(async (): Promise<{ token: string; socketUrl: string } | null> => {
    if (inFlightTokenRef.current) {
      return inFlightTokenRef.current;
    }
    if (authFailureCountRef.current >= 3) {
      console.warn("[useSocket] Max consecutive auth failure attempts reached. Halting reconnect.");
      return null;
    }

    inFlightTokenRef.current = (async () => {
      try {
        const res = await fetch("/api/socket/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
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
        inFlightTokenRef.current = null;
      }
    })();

    return inFlightTokenRef.current;
  }, []);

  useEffect(() => {
    if (!userId) {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      authFailureCountRef.current = 0;
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
        authFailureCountRef.current = 0;
        if (isMounted) setSocket(instance);
      });

      instance.on("auth_expired", async () => {
        const fresh = await fetchToken();
        if (fresh && socketRef.current) {
          socketRef.current.auth = { token: fresh.token };
          socketRef.current.connect();
        }
      });

      instance.on("account_revoked", () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        if (isMounted) setSocket(null);
      });

      instance.on("connect_error", async (err: Error) => {
        if (!isMounted) return;
        // Refresh token if expired or auth error
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
