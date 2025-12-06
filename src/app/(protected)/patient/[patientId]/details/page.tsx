"use client";

import { useState, useEffect } from "react";

export default function PatientDetails() {
  const [loading, setLoading] = useState(false);           // For GET loading
  const [updating, setUpdating] = useState(false);         // For PUT loading

  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");

  // ============================
  // 🔵 FETCH PATIENT INFO (GET)
  // ============================
  useEffect(() => {
    const loadInfo = async () => {
      setLoading(true);

      try {
        const res = await fetch("/api/patient/info", {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          return; // If first time user → no info exists
        }

        const data = await res.json();

        setMedicalHistory(data.medicalHistory || "");
        setAllergies(data.allergies || "");
        setCurrentMedications(data.currentMedications || "");

      } catch (error) {
        console.error("Failed to load patient info", error);
      } finally {
        setLoading(false);
      }
    };

    loadInfo();
  }, []);

  // ============================
  // 🟢 UPDATE INFO (PUT)
  // ============================
  const updateInfo = async () => {
    try {
      setUpdating(true); // Start loading button

      const res = await fetch("/api/patient/info", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicalHistory, allergies, currentMedications }),
      });

      const data = await res.json();

      if (res.ok) {
        alert("Information Updated Successfully!");
      } else {
        alert(data.error || "Failed to update");
      }
    } catch (err) {
      console.error("Update error:", err);
      alert("Something went wrong updating info.");
    } finally {
      setUpdating(false);
    }
  };

  // ============================
  // UI
  // ============================
  return (
    <div className="max-w-lg mx-auto p-6 shadow rounded bg-white">
      <h2 className="text-xl font-bold mb-4">Patient Medical Details</h2>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading information...</p>
      ) : (
        <>
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

          <button
            onClick={updateInfo}
            disabled={updating}
            className={`px-4 py-2 rounded text-white transition ${
              updating
                ? "bg-gray-500 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {updating ? "Updating..." : "Update Info"}
          </button>
        </>
      )}
    </div>
  );
}
