
'use client';

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MessageCircle, AlertCircle, Stethoscope } from "lucide-react";
import LoadingSpinner from "@/components/general/LoadingSpinner";
import EmptyState from "@/components/general/EmptyState";

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
            if (!user?.id) {
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                const res = await fetch(
                    `/api/doctorpatientrelations?userId=${user.id}&role=${user.role}`
                );

                if (!res.ok) {
                    const errData = await res.json().catch(() => ({}));
                    throw new Error(errData?.error || "Failed to load chats");
                }

                const data = await res.json();
                setChats(data?.relations || []);
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : "Unable to load chats";
                setError(errorMessage);
            } finally {
                setLoading(false);
            }
        };

        fetchChats();
    }, [user?.id, user?.role]);

    const handleOpenChat = (relationId: string) => {
        router.push(`/patient/chat/${relationId}`);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <LoadingSpinner />
            </div>
        );
    }

    if (!user?.id || user.role !== "PATIENT") {
        return (
            <Card className="max-w-2xl mx-auto border shadow-sm">
                <CardContent className="p-6">
                    <div className="flex items-center gap-3 text-destructive">
                        <AlertCircle className="h-5 w-5" />
                        <p className="text-sm font-medium">Please log in as a patient to view your chats.</p>
                    </div>
                </CardContent>
            </Card>
        );
    }

    return (
        <div className="space-y-6">
            <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <div>
                    <h1 className="text-3xl font-bold mb-2">Messages</h1>
                    <p className="text-muted-foreground">Chat with your healthcare providers</p>
                </div>
            </motion.div>

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <LoadingSpinner />
                </div>
            ) : error ? (
                <Card className="border-destructive border-2">
                    <CardContent className="p-4">
                        <div className="flex items-center gap-3 text-destructive">
                            <AlertCircle className="h-5 w-5" />
                            <p className="text-sm font-medium">{error}</p>
                        </div>
                    </CardContent>
                </Card>
            ) : chats.length === 0 ? (
                <EmptyState
                    icon={MessageCircle}
                    title="No conversations yet"
                    description="Start a chat from a doctor profile to begin messaging with your healthcare providers."
                    actionLabel="Find Doctors"
                    onAction={() => router.push("/patient/findDoctors")}
                />
            ) : (
                <div className="grid gap-4">
                    {chats.map((chat, index) => {
                        const lastLine = chat.lastMessage
                            ? chat.lastMessage.length > 50
                                ? chat.lastMessage.substring(0, 50) + "..."
                                : chat.lastMessage
                            : "No messages yet";

                        return (
                            <motion.div
                                key={chat.id}
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: index * 0.1 }}
                            >
                                <Card 
                                    className="border shadow-sm hover:shadow-md transition-all cursor-pointer"
                                    onClick={() => handleOpenChat(chat.id)}
                                >
                                    <CardContent className="p-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-4 flex-1">
                                                <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center shrink-0">
                                                    <span className="text-primary font-bold text-sm">Dr</span>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-semibold text-foreground truncate">Dr. {chat.doctorName}</p>
                                                    <p className="text-sm text-muted-foreground truncate">Patient: {chat.patientName}</p>
                                                    <p className="text-sm text-muted-foreground mt-1 truncate">{lastLine}</p>
                                                </div>
                                            </div>
                                            <div className="text-xs text-muted-foreground whitespace-nowrap">
                                                {new Date(chat.lastMessageAt).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            </motion.div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
