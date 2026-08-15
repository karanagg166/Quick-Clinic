"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

export const useSocket = () => {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";
    let isMounted = true;
    let socketInstance: Socket | null = null;

    const initSocket = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 1200);

        const healthRes = await fetch(`${socketUrl}/health`, {
          method: "GET",
          signal: controller.signal,
        }).catch(() => null);

        clearTimeout(timeoutId);

        if (!healthRes || !healthRes.ok || !isMounted) {
          return;
        }

        socketInstance = io(socketUrl, {
          path: "/socket.io",
          transports: ["websocket", "polling"],
          reconnectionAttempts: 3,
          timeout: 3000,
        });

        socketInstance.on("connect", () => {
          console.log("Socket connected:", socketInstance?.id);
        });

        socketInstance.on("connect_error", () => {
          // Graceful handling
        });

        if (isMounted) {
          setSocket(socketInstance);
        }
      } catch {
        // Silently catch offline socket error
      }
    };

    initSocket();

    return () => {
      isMounted = false;
      if (socketInstance) {
        socketInstance.disconnect();
      }
    };
  }, []);

  return socket;
};
