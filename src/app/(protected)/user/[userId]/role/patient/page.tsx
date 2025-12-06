"use client";

import { useState } from "react";
import { useUserStore } from "@/store/index";
import { useRouter } from "next/navigation";
export default function PatientDetails() {
  const [loading, setLoading] = useState(false);
  
  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");

  const updateUser = useUserStore((state) => state.updateUser);
  const getUser= useUserStore((state) => state.user);
  const router = useRouter();
  // CREATE
  const createInfo = async () => {
    try {
      setLoading(true); // START LOADING

      const response = await fetch(`/api/user/${getUser?.userId}/role/patient`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          medicalHistory,
          allergies,
          currentMedications,
        }),
      });

      const text = await response.text();
      console.log("RAW RESPONSE:", text);

      try {
        const data = JSON.parse(text);
        console.log("JSON RESPONSE:", data);

        if (response.ok) {
          updateUser({ patientId: data.patient.id });
          alert("Information saved successfully!");
          router.push(`/patient/${data.userId}/dashboard`);
        } else {
          alert(data.error || "Something went wrong");
        }
      } catch (err) {
        console.error("NOT JSON:", err);
        alert("Server returned invalid response.");
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
