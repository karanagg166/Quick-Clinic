
'use client'
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import BookTimeSlot from "@/components/patient/bookTimeSlot";
import { useUserStore } from "@/store/userStore";
import type {Doctor} from "@/types/doctor";

export default function DoctorDetails() {
  const router = useRouter();
  const params = useParams();
  const doctorId = params.doctorId as string;
  const [doctor, setDoctor] = useState<Doctor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const { user } = useUserStore();

  useEffect(() => {
    const fetchDoctor = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/doctors/${doctorId}`);
        if (!res.ok) {
          throw new Error("Failed to fetch doctor details");
        }
        const data = await res.json();
        console.log("Doctor data:", data);
        setDoctor(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (doctorId) {
      fetchDoctor();
    }
  }, [doctorId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-center text-gray-600">Loading doctor details...</p>
      </div>
    );
  }

  if (error || !doctor) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-center text-red-600">{error || "Doctor not found"}</p>
      </div>
    );
  }

  const startConversation = async () => {
    try {
      if (!user?.userId) {
        alert("Please log in as a patient to start a chat.");
        return;
      }

      if (!doctor?.userId) {
        alert("Doctor details are incomplete. Please try again.");
        return;
      }

      setStartingChat(true);

      const res = await fetch("/api/doctorpatientrelations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorsUserId: doctor.userId,
          patientsUserId: user.userId,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || "Failed to start conversation");
      }

      const data = await res.json();
      const relationId = data?.relation?.id;

      if (!relationId) {
        throw new Error("Missing relation id from server");
      }

      router.push(`/patient/chat/${relationId}`);
    } catch (err: any) {
      alert(err?.message || "Could not start conversation. Please try again.");
    } finally {
      setStartingChat(false);
    }
  };

  return (
    <>
      <div className="max-w-3xl mx-auto p-6 shadow rounded">
        <h2 className="text-2xl font-bold mb-4">Doctor Details</h2>
        {/* Doctor information section */}
        <div className="mb-6">
          <h3 className="text-xl font-semibold">Dr. {doctor.name} </h3>
          <p className="text-gray-600">Age: {doctor.age}</p>
          <p className="text-gray-600">Gender: {doctor.gender}</p>
          <p className="text-gray-600">Specialization: {doctor.specialty}</p>

          <p className="text-gray-600">Experience: {doctor.experience} years</p>
          <p className="text-gray-600">Fees: ₹{doctor.fees}</p>
          <p className="text-gray-600">Location: {doctor.city}, {doctor.state}</p>
          <p className="text-gray-600">Contact:
            <a href={`mailto:${doctor.email}`}>{doctor.email}</a>
          </p>
          
        </div>
        {/* Book appointment section */}
        <BookTimeSlot doctorId={doctorId}/>
        </div>

        <div className="max-w-3xl mx-auto p-6 mt-6 bg-blue-50 border border-blue-100 rounded-lg shadow-sm">
          <h3 className="text-xl font-semibold text-blue-800 mb-2">Have questions?</h3>
          <p className="text-sm text-blue-900 mb-3">
            Start a conversation with the doctor to clarify symptoms, medications, or next steps.
          </p>
          <div className="flex flex-wrap gap-3 text-sm text-blue-900">
            <button
              type="button"
              onClick={startConversation}
              disabled={startingChat}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md shadow hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
            >
              {startingChat ? "Starting..." : "💬 Start real-time chat"}
            </button>
          </div>
        </div>
        </>

        
    );
}