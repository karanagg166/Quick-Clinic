'use client'
import {useEffect,useState} from "react";
import {useRouter,useParams} from "next/navigation";

import {useUserStore} from "@/store/userStore";
import type {Patient} from "@/types/patient";

export default function PatientDetails() {
    const router = useRouter();
    const params = useParams();
    const patientId = params.patientId as string;
    const [patient, setPatient] = useState<Patient | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [startingChat, setStartingChat] = useState(false);
    const { user } = useUserStore();

    useEffect(() => {
        const fetchPatient = async () => {
            try {
                setLoading(true);
                const res = await fetch(`/api/patients/${patientId}`);
                if (!res.ok) {
                    throw new Error("Failed to fetch patient details");
                }
                const data = await res.json();
                console.log("Patient data:", data);
                setPatient(data);
            } catch (err) {
                setError(err instanceof Error ? err.message : "An error occurred");
            } finally {
                setLoading(false);
            }
        };

        if (patientId) {
            fetchPatient();
        }
    }, [patientId]);
    
    if (loading) {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <p className="text-center text-gray-600">Loading patient details...</p>
            </div>
        );
    }
    if (error || !patient) {
        return (
            <div className="max-w-3xl mx-auto p-6">
                <p className="text-center text-red-600">{error || "Patient not found"}</p>
            </div>
        );
    }
    
    const startConversation = async () => { 
        try {
            if (!user?.userId) {
                alert("You must be logged in to start a conversation.");
                return;
            }
            setStartingChat(true);
            const res = await fetch(`/api/doctorpatientrelations`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    doctorsUserId: user.userId,
                    patientsUserId: patient.userId,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data?.error || "Failed to start conversation");
            }
            // router.push(`/doctor/chat/${relationId}`);
        } catch (err) {
            alert(err instanceof Error ? err.message : "An error occurred");
        } finally {
            setStartingChat(false);
        }
    };
    console.log("PatientDetails render:", { patient });
    return (
        <div className="max-w-3xl mx-auto p-6 bg-white shadow-md rounded">
            <h1 className="text-2xl font-bold mb-4">Patient Details</h1>
            <p><strong>Name:</strong> {patient.patient.name}</p>
            <p><strong>Age:</strong> {patient.patient.age}</p>
            <p><strong>Gender:</strong> {patient.patient.gender}</p>
            <p><strong>Email:</strong> {patient.patient.email}</p>
            <p><strong>City:</strong> {patient.patient.city}</p>
            <p><strong>State:</strong> {patient.patient.state}</p>
            <p> <strong>Phone No:</strong> {patient.patient.phoneNo}</p>
            <p><strong>Medical History:</strong> {patient.patient.medicalHistory || "None"}</p> 
            <p><strong>Allergies:</strong> {patient.patient.allergies || "None"}</p> 
            <p><strong>Medications:</strong> {patient.patient.currentMedications || "None"}</p>
            
            <button
                onClick={startConversation}
                disabled={startingChat}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
                {startingChat ? "Starting Chat..." : "Start Conversation"}
            </button>
        </div>
    );


}