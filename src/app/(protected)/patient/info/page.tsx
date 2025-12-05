"use client";

import { useState, useEffect } from "react";

export default function PatientInfo() {
  const [loading, setLoading] = useState(false);
  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");
  const [exists, setExists] = useState(false);

  // GET PATIENT INFO
  useEffect(() => {
    const loadInfo = async () => {
      try {
        setLoading(true);

        const res = await fetch("/api/patient/info", {
          method: "GET",
          credentials: "include", // 🔥 IMPORTANT
        });

        if (!res.ok) {
          setExists(false);
          return;
        }

        const data = await res.json();

        setMedicalHistory(data.medicalHistory);
        setAllergies(data.allergies);
        setCurrentMedications(data.currentMedications);
        setExists(true);
      } catch (e) {
        setExists(false);
      } finally {
        setLoading(false);
      }
    };

    loadInfo();
  }, []);

  // CREATE
  const createInfo = async () => {
    const response = await fetch("/api/patient/info", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    medicalHistory,
    allergies,
    currentMedications,
  }),
});

const text = await response.text(); // <--- READ RAW RESPONSE

console.log("RAW RESPONSE:", text);

try {
  const data = JSON.parse(text);
  alert("Created");
  console.log("JSON RESPONSE:", data);
} catch (err) {
  console.error("NOT JSON:", err);
}

  };

  // UPDATE
  const updateInfo = async () => {
    const res = await fetch("/api/patient/info", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ medicalHistory, allergies, currentMedications }),
    });

    const data = await res.json();
    if (res.ok) {
      alert("Updated");
    } else {
      alert(data.error);
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

      {!exists ? (
        <button
          className="bg-green-600 text-white px-4 py-2 rounded"
          onClick={createInfo}
        >
          Create Info
        </button>
      ) : (
        <button
          className="bg-blue-600 text-white px-4 py-2 rounded"
          onClick={updateInfo}
        >
          Update Info
        </button>
      )}
    </div>
  );
}
