"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

export const useSocket = () => {
    const socketRef = useRef<Socket | null>(null);

    useEffect(() => {
        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

        const socketInstance = io(socketUrl, {
            path: "/socket.io",
            transports: ["websocket"],
            reconnectionAttempts: 5,
        });

        socketInstance.on("connect", () => {
            console.log("Socket connected:", socketInstance.id);
        });

        socketRef.current = socketInstance;

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    return socketRef.current;
};
