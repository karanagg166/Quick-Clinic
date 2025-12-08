"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore";
export default function PatientDetails() {
  const userId = useUserStore((state) => state.user?.userId);
  const setUser = useUserStore((state) => state.setUser);
  const user=useUserStore((state) => state.user);
  const [loading, setLoading] = useState(false);
  
  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");

  const router = useRouter();
  // CREATE
  const createInfo = async () => {
    if (!userId || Array.isArray(userId)) {
      alert("Missing user id from URL.");
      return;
    }

    try {
      setLoading(true); // START LOADING

      const response = await fetch("/api/patients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          medicalHistory,
          allergies,
          currentMedications,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Patient info saved successfully.");
        if(user){
setUser(user, data.patient.id, undefined);
        }
        
        router.push(`/patient`);
      } else {
        alert(data.error || "Failed to save info.");
      }

      
    } catch (error) {
      console.error("Error:", error);
      alert("Failed to save info.");
    } finally {
      setLoading(false); // END LOADING
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 shadow rounded">
      <h2 className="text-xl font-bold mb-4">Patient Info</h2>

      <textarea
        value={medicalHistory}
        onChange={(e) => setMedicalHistory(e.target.value)}
        placeholder="Medical History"
        className="w-full border p-2 mb-3"
      />

      <textarea
        value={allergies}
        onChange={(e) => setAllergies(e.target.value)}
        placeholder="Allergies"
        className="w-full border p-2 mb-3"
      />

      <textarea
        value={currentMedications}
        onChange={(e) => setCurrentMedications(e.target.value)}
        placeholder="Current Medications"
        className="w-full border p-2 mb-3"
      />

      <button
        className={`px-4 py-2 rounded text-white transition ${
          loading
            ? "bg-gray-500 cursor-not-allowed"
            : "bg-green-600 hover:bg-green-700"
        }`}
        onClick={createInfo}
        disabled={loading}
      >
        {loading ? "Saving..." : "Create Info"}
      </button>

      {loading && (
        <p className="mt-3 text-sm text-gray-500 animate-pulse">
          Processing, please wait...
        </p>
      )}
    </div>
  );
}
