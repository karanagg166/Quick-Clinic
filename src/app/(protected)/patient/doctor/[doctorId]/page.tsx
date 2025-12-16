
'use client'
import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import BookTimeSlot from "@/components/patient/bookTimeSlot";
import { useUserStore } from "@/store/userStore";
import Avatar from "@/components/general/Avatar";
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
        console.log("Full response:", data);
        console.log("data.doctor:", data.doctor);
        
        if (!data.doctor) {
          throw new Error("Doctor data is missing from response");
        }
        
        setDoctor(data.doctor);

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
        console.log(doctor);
        console.log(doctor?.age);
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
        <h2 className="text-2xl font-bold mb-6">Doctor Details</h2>
        
        {/* Doctor Information Section with Avatar */}
        <div className="mb-6 bg-gradient-to-r from-blue-50 to-blue-100 p-6 rounded-lg border border-blue-200">
          <div className="flex gap-6 items-start">
            <Avatar 
              src={doctor.profileImageUrl} 
              name={doctor.name || "Doctor"}
              size="xl"
            />
            <div className="flex-1">
              <h3 className="text-3xl font-semibold mb-1">Dr. {doctor.name}</h3>
              <p className="text-lg text-blue-700 font-medium mb-4">{doctor.specialty}</p>
              
              <div className="grid grid-cols-2 gap-3 text-sm">
                <p className="text-gray-700"><strong>Age:</strong> {doctor.age}</p>
                <p className="text-gray-700"><strong>Gender:</strong> {doctor.gender}</p>
                <p className="text-gray-700"><strong>Experience:</strong> {doctor.experience} years</p>
                <p className="text-gray-700"><strong>Fees:</strong> ₹{doctor.fees}</p>
                <p className="text-gray-700"><strong>Location:</strong> {doctor.city}, {doctor.state}</p>
                <p className="text-gray-700"><strong>Email:</strong> 
                  <a href={`mailto:${doctor.email}`} className="text-blue-600 hover:underline ml-1">{doctor.email}</a>
                </p>
              </div>
            </div>
          </div>
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