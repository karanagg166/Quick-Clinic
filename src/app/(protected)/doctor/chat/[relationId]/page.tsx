'use client'

import ChatBar from "@/components/general/ChatBar";
import { useUserStore } from "@/store/userStore";
import { use } from "react";

export default function DoctorChatPage({ params }: { params: Promise<{ relationId: string }> }) {
    const userId = useUserStore((state) => state.user?.userId);
    const resolvedParams = use(params);
    const doctorPatientRelationId = resolvedParams.relationId;

    if (!userId) {
        return <div>Loading user data...</div>;
    }

    return (
        <div>
            <h1>Doctor Chat</h1>
            <ChatBar 
                doctorPatientRelationId={doctorPatientRelationId} 
                userId={userId} 
            />
        </div>
    );
}