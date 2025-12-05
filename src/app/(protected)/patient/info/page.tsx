"use client";

import { useState, useEffect } from "react";

export default function PatientInfo() {
  const [loading, setLoading] = useState(false);
  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");
  const [existingPatient, setExistingPatient] = useState(false);

  // GET PATIENT INFO ON LOAD
  useEffect(() => {
    const handleGetInfo = async () => {
      try {
        setLoading(true);

        const response = await fetch("/api/patient/info");
        const data = await response.json();
        
        if (response.ok && data.patient) {
          setExistingPatient(true);
          setMedicalHistory(data.patient.medicalHistory || "");
          setAllergies(data.patient.allergies || "");
          setCurrentMedications(data.patient.currentMedications || "");
        } else {
          setExistingPatient(false);
        }
      } catch (err: any) {
        console.error("Fetch Error:", err);
        setExistingPatient(false);
      } finally {
        setLoading(false);
      }
    };

    handleGetInfo();
  }, []);

  // UPDATE PATIENT INFO
  const handleUpdateInfo = async () => {
    try {
      setLoading(true);

      const response = await fetch("/api/patient/info", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          medicalHistory,
          allergies,
          currentMedications,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Patient Info Updated Successfully");
      } else {
        alert(data.error || "Update failed");
      }

    } catch (err: any) {
      console.error("Update Error:", err);
    } finally {
      setLoading(false);
    }
  };

  // CREATE PATIENT INFO
  const handleCreateInfo = async () => {
    try {
      setLoading(true);

      const response = await fetch("/api/patient/info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          medicalHistory,
          allergies,
          currentMedications,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setExistingPatient(true);
        alert("Patient Info Created Successfully");
      } else {
        alert(data.error || "Creation failed");
      }

    } catch (err: any) {
      console.error("Create Error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg mt-6">
      <h2 className="text-2xl font-bold mb-4 text-center">
        Patient Medical Information
      </h2>

      {loading && (
        <p className="text-blue-600 text-center font-semibold mb-2">
          Loading...
        </p>
      )}

      <label className="block font-semibold mt-3">Medical History:</label>
      <textarea
        value={medicalHistory}
        onChange={(e) => setMedicalHistory(e.target.value)}
        className="w-full border p-2 rounded mt-1"
        rows={3}
        placeholder="Enter medical history"
      />

      <label className="block font-semibold mt-3">Allergies:</label>
      <textarea
        value={allergies}
        onChange={(e) => setAllergies(e.target.value)}
        className="w-full border p-2 rounded mt-1"
        rows={2}
        placeholder="Enter allergies"
      />

      <label className="block font-semibold mt-3">Current Medications:</label>
      <textarea
        value={currentMedications}
        onChange={(e) => setCurrentMedications(e.target.value)}
        className="w-full border p-2 rounded mt-1"
        rows={2}
        placeholder="Enter medications"
      />

      <div className="mt-6 flex justify-between">
        {!existingPatient ? (
          <button
            onClick={handleCreateInfo}
            disabled={loading}
            className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
          >
            Create Info
          </button>
        ) : (
          <button
            onClick={handleUpdateInfo}
            disabled={loading}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            Update Info
          </button>
        )}
      </div>
    </div>
  );
}
