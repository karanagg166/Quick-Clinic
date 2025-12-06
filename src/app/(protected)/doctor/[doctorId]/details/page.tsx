"use client";

import { useState, useEffect } from "react";

export default function DoctorDetails() {
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");
  const [specialty, setSpecialty] = useState("");

  const [specialties, setSpecialties] = useState<string[]>([]);
  const [qualifications, setQualifications] = useState<string[]>([]);
  const [qualification, setQualification] = useState<string[]>([]);

  const [existingDoctor, setExistingDoctor] = useState(false);

  // Loading states
  const [initialLoading, setInitialLoading] = useState(true); // doctor info
  const [enumLoading, setEnumLoading] = useState(true); // enums loading
  const [actionLoading, setActionLoading] = useState(false); // update/create loading

  // Toggle qualification
  const toggleQualification = (value: string) => {
    setQualification((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    );
  };

  // --------------------------------------------------------------
  // 1️⃣ Fetch DOCTOR INFO if exists
  // --------------------------------------------------------------
  useEffect(() => {
    const getInfo = async () => {
      try {
        setInitialLoading(true);

        const res = await fetch("/api/doctor/info", {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          setExistingDoctor(false);
          return;
        }

        const data = await res.json();

        setFees(String(data.fees));
        setExperience(String(data.experience));
        setSpecialty(data.specialty);
        setQualification(data.qualifications);

        setExistingDoctor(true);
      } catch (err) {
        console.log("Doctor info not found yet.");
      } finally {
        setInitialLoading(false);
      }
    };

    getInfo();
  }, []);

  // --------------------------------------------------------------
  // 2️⃣ Fetch ENUM VALUES
  // --------------------------------------------------------------
  useEffect(() => {
    const fetchEnums = async () => {
      try {
        setEnumLoading(true);

        const sp = await fetch("/api/doctors/specializations");
        const spData = await sp.json();
        if (sp.ok) setSpecialties(spData.specialties);

        const q = await fetch("/api/doctors/qualifications");
        const qData = await q.json();
        if (q.ok) setQualifications(qData.qualifications);

      } catch (err: any) {
        console.error("Enum fetch error:", err.message);
      } finally {
        setEnumLoading(false);
      }
    };

    fetchEnums();
  }, []);

  // --------------------------------------------------------------
  // 3️⃣ UPDATE DOCTOR INFO
  // --------------------------------------------------------------
  const handleUpdateInfo = async () => {
    try {
      setActionLoading(true);

      const res = await fetch("/api/doctor/info", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fees: Number(fees),
          experience: Number(experience),
          specialty,
          qualifications: qualification,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        alert("Doctor info updated successfully.");
      } else {
        alert("Error updating info: " + data.error);
      }

    } catch (err: any) {
      alert("Update error: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // --------------------------------------------------------------
  // 4️⃣ CREATE DOCTOR INFO (if not exists)
  // --------------------------------------------------------------
  const handleCreateInfo = async () => {
    try {
      setActionLoading(true);

      const res = await fetch("/api/doctor/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          fees: Number(fees),
          experience: Number(experience),
          specialty,
          qualifications: qualification,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setExistingDoctor(true);
        alert("Doctor info created successfully.");
      } else {
        alert("Error creating info: " + data.error);
      }

    } catch (err: any) {
      alert("Create error: " + err.message);
    } finally {
      setActionLoading(false);
    }
  };

  // --------------------------------------------------------------
  // UI START
  // --------------------------------------------------------------
  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg mt-6">
      <h2 className="text-2xl font-bold mb-4 text-center">
        Doctor Information
      </h2>

      {(initialLoading || enumLoading) && (
        <p className="text-blue-600 animate-pulse mb-4">
          Loading doctor data...
        </p>
      )}

      {/* FEES */}
      <label className="block font-semibold mt-3">Fees:</label>
      <input
        type="number"
        value={fees}
        onChange={(e) => setFees(e.target.value)}
        className="w-full border p-2 rounded"
      />

      {/* EXPERIENCE */}
      <label className="block font-semibold mt-3">Experience (years):</label>
      <input
        type="number"
        value={experience}
        onChange={(e) => setExperience(e.target.value)}
        className="w-full border p-2 rounded"
      />

      {/* SPECIALTY */}
      <label className="block font-semibold mt-3">Specialty:</label>
      <select
        value={specialty}
        onChange={(e) => setSpecialty(e.target.value)}
        className="w-full border p-2 rounded"
        disabled={enumLoading}
      >
        <option value="">Select specialty</option>
        {specialties.map((sp) => (
          <option key={sp} value={sp}>
            {sp}
          </option>
        ))}
      </select>

      {/* QUALIFICATIONS */}
      <label className="block font-semibold mt-4">Qualifications:</label>

      <div className="border p-3 rounded max-h-48 overflow-y-auto space-y-2 bg-gray-50">
        {!enumLoading &&
          qualifications.map((q) => (
            <label key={q} className="flex items-center gap-2 cursor-pointer text-sm">
              <input
                type="checkbox"
                value={q}
                checked={qualification.includes(q)}
                onChange={() => toggleQualification(q)}
                className="h-4 w-4"
              />
              <span>{q}</span>
            </label>
          ))}

        {enumLoading && (
          <p className="text-gray-500 text-sm">Loading qualifications...</p>
        )}
      </div>

      {/* BUTTONS */}
      <div className="mt-6 flex justify-end">
        {!existingDoctor ? (
          <button
            className={`px-4 py-2 rounded text-white ${
              actionLoading ? "bg-gray-400" : "bg-green-600 hover:bg-green-700"
            }`}
            disabled={actionLoading}
            onClick={handleCreateInfo}
          >
            {actionLoading ? "Saving..." : "Create Info"}
          </button>
        ) : (
          <button
            className={`px-4 py-2 rounded text-white ${
              actionLoading ? "bg-gray-400" : "bg-blue-600 hover:bg-blue-700"
            }`}
            disabled={actionLoading}
            onClick={handleUpdateInfo}
          >
            {actionLoading ? "Saving..." : "Update Info"}
          </button>
        )}
      </div>
    </div>
  );
}
