

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
        <div className="max-w-4xl mx-auto p-6">
            {/* Header */}
            <div className="mb-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-2">Messages</h1>
                <p className="text-gray-600">Chat with your healthcare providers</p>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <div className="text-center">
                        <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-3"></div>
                        <p className="text-gray-600">Loading conversations...</p>
                    </div>
                </div>
            ) : error ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center gap-3">
                    <span className="text-xl">⚠️</span>
                    <p>{error}</p>
                </div>
            ) : chats.length === 0 ? (
                <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                    <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <span className="text-4xl">💬</span>
                    </div>
                    <p className="text-gray-900 font-semibold text-lg mb-2">No conversations yet</p>
                    <p className="text-gray-600">Start a chat from a doctor profile to begin messaging</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {chats.map((chat) => {
                        const lastLine = chat.lastMessage
                            ? chat.lastMessage.length > 50
                                ? chat.lastMessage.substring(0, 50) + "..."
                                : chat.lastMessage
                            : "No messages yet";

                        return (
                            <button
                                key={chat.id}
                                onClick={() => handleOpenChat(chat.id)}
                                className="w-full text-left bg-white border border-gray-200 rounded-lg p-4 hover:border-blue-400 hover:shadow-md hover:bg-blue-50 transition-all duration-200 group"
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className="w-12 h-12 bg-linear-to-br from-blue-400 to-blue-600 rounded-full flex items-center justify-center shrink-0">
                                            <span className="text-white font-bold text-lg">Dr</span>
                                        </div>
                                    <div>
                                            <p className="font-semibold text-gray-900 group-hover:text-blue-600">Dr. {chat.doctorName}</p>
                                        <p className="text-sm text-gray-600">Patient: {chat.patientName}</p>
                                    </div>
                                    </div>
                                    <span className="text-xs text-gray-500 whitespace-nowrap ml-4">
                                        {new Date(chat.lastMessageAt).toLocaleDateString()}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-700 line-clamp-1 ml-16">{lastLine}</p>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
