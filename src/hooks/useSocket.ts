"use client";

import { useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";

export const useSocket = () => {
    const [socket, setSocket] = useState<Socket | null>(null);

    useEffect(() => {
        // Assuming socket server is on same origin or specified via env
        // NEXT_PUBLIC_SOCKET_URL
        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:3001";

        const socketInstance = io(socketUrl, {
            path: "/socket.io",
            transports: ["websocket"],
            reconnectionAttempts: 5,
        });

        socketInstance.on("connect", () => {
            console.log("Socket connected:", socketInstance.id);
        });

        setSocket(socketInstance);

        return () => {
            socketInstance.disconnect();
        };
    }, []);

    return socket;
};
