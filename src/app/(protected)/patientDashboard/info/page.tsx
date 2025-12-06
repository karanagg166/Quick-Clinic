"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";

export default function PatientInfo() {
  const { user, patientId } = useUserStore();
  const [loading, setLoading] = useState(false);
  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");
  const [exists, setExists] = useState(false);

  // GET PATIENT INFO
  useEffect(() => {
    const loadInfo = async () => {
      try {
        if (!patientId) return;

        setLoading(true);

        const res = await fetch(`/api/patients/${patientId}`, {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          setExists(false);
          return;
        }

        const data = await res.json();

        setMedicalHistory(data.patient.medicalHistory || "");
        setAllergies(data.patient.allergies || "");
        setCurrentMedications(data.patient.currentMedications || "");
        setExists(true);
      } catch (e) {
        setExists(false);
      } finally {
        setLoading(false);
      }
    };

    loadInfo();
  }, [patientId]);

  // CREATE
  const createInfo = async () => {
    try {
      if (!user?.userId) {
        alert("User ID not found");
        return;
      }

      setLoading(true);

      const response = await fetch("/api/patients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          medicalHistory,
          allergies,
          currentMedications,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setExists(true);
        alert("Patient info created successfully");
      } else {
        alert(data.error || "Failed to create info");
      }
    } catch (err: any) {
      alert(err.message || "Create error");
      console.error("Create error:", err);
    } finally {
      setLoading(false);
    }
  };

  // UPDATE
  const updateInfo = async () => {
    try {
      if (!patientId) {
        alert("Patient ID not found");
        return;
      }

      setLoading(true);

      const res = await fetch(`/api/patients/${patientId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicalHistory, allergies, currentMedications }),
      });

      const data = await res.json();
      if (res.ok) {
        alert("Patient info updated successfully");
      } else {
        alert(data.error || "Update failed");
      }
    } catch (err: any) {
      alert(err.message || "Update error");
      console.error("Update error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg mt-6">
      <h2 className="text-2xl font-bold mb-4 text-center">Patient Information</h2>

      {loading && <p className="text-blue-600 mb-4">Loading...</p>}

      <textarea
        value={medicalHistory}
        onChange={(e) => setMedicalHistory(e.target.value)}
        placeholder="Medical History"
        className="w-full border p-2 mb-3 rounded"
      />

      <textarea
        value={allergies}
        onChange={(e) => setAllergies(e.target.value)}
        placeholder="Allergies"
        className="w-full border p-2 mb-3 rounded"
      />

      <textarea
        value={currentMedications}
        onChange={(e) => setCurrentMedications(e.target.value)}
        placeholder="Current Medications"
        className="w-full border p-2 mb-3 rounded"
      />

      <div className="mt-6 flex justify-end">
        {!exists ? (
          <button
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
            onClick={createInfo}
            disabled={loading}
          >
            {loading ? "Creating..." : "Create Info"}
          </button>
        ) : (
          <button
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            onClick={updateInfo}
            disabled={loading}
          >
            {loading ? "Updating..." : "Update Info"}
          </button>
        )}
      </div>
    </div>
  );
}
