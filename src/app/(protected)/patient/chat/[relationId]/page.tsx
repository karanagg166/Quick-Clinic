'use client'

import { use } from "react";
import { motion } from "framer-motion";
import ChatBar from "@/components/general/ChatBar";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageCircle } from "lucide-react";
import LoadingSpinner from "@/components/general/LoadingSpinner";

export default function PatientChatPage({ params }: { params: Promise<{ relationId: string }> }) {
    const userId = useUserStore((state) => state.user?.id);
    const resolvedParams = use(params);
    const doctorPatientRelationId = resolvedParams.relationId;

    if (!userId) {
        return (
            <div className="flex items-center justify-center min-h-[400px]">
                <LoadingSpinner />
            </div>
        );
    }

    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="space-y-6"
        >
            <Card className="border shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MessageCircle className="w-5 h-5" />
                        Chat
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <ChatBar 
                        doctorPatientRelationId={doctorPatientRelationId} 
                        userId={userId} 
                    />
                </CardContent>
            </Card>
        </motion.div>
    );
}