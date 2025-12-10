

'use client';

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore";

interface ChatListItem {
    id: string;
    doctorName: string;
    patientName: string;
    lastMessage: string | null;
    lastMessageAt: string;
}

export default function ChatPage() {
    const router = useRouter();
    const { user, isLoading } = useUserStore();
    const [chats, setChats] = useState<ChatListItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchChats = async () => {
            if (!user?.userId) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const res = await fetch(
                    `/api/doctorpatientrelations?userId=${user.userId}&role=${user.role}`
                );

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData?.error || "Failed to load chats");
                }

                const data = await res.json();
                setChats(data?.relations || []);
            } catch (err: any) {
                setError(err?.message || "Unable to load chats");
            } finally {
                setLoading(false);
            }
        };

        fetchChats();
    }, [user?.userId, user?.role]);

    const handleOpenChat = (relationId: string) => {
        router.push(`/patient/chat/${relationId}`);
    };

    if (isLoading) {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <p className="text-gray-600">Loading user...</p>
            </div>
        );
    }

    if (!user?.userId || user.role !== "PATIENT") {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <p className="text-gray-600">Please log in as a patient to view your chats.</p>
            </div>
        );
    }

    return (
        <div className="max-w-3xl mx-auto p-6">
            <h2 className="text-2xl font-bold mb-4">Your Chats</h2>

            {loading ? (
                <p className="text-gray-600">Loading conversations...</p>
            ) : error ? (
                <p className="text-red-600">{error}</p>
            ) : chats.length === 0 ? (
                <p className="text-gray-600">No conversations yet. Start a chat from a doctor profile.</p>
            ) : (
                <div className="space-y-3">
                    {chats.map((chat) => {
                        const lastLine = chat.lastMessage
                            ? chat.lastMessage
                            : "No messages yet";

                        return (
                            <button
                                key={chat.id}
                                onClick={() => handleOpenChat(chat.id)}
                                className="w-full text-left bg-white border border-gray-200 rounded-lg shadow-sm px-4 py-3 hover:border-blue-300 hover:shadow transition"
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-semibold text-gray-900">Dr. {chat.doctorName}</p>
                                        <p className="text-sm text-gray-600">Patient: {chat.patientName}</p>
                                    </div>
                                    <span className="text-xs text-gray-500">
                                        {new Date(chat.lastMessageAt).toLocaleString()}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-700 mt-1 line-clamp-1">{lastLine}</p>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
