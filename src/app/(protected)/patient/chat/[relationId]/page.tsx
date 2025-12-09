'use client'



import ChatBar from "@/components/general/ChatBar";

export default function TestPage() {
    return (
        <div>
            <h1>Patient chat Bar test Page</h1>
            <ChatBar 
                doctorPatientRelationId="relation-uuid-here" 
                userId="patient-uuid-here" 
            />
        </div>
    );
}