"use client";

import { useState, useEffect } from "react";

export default function DoctorInfo() {
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");

  const [specialization, setSpecialization] = useState(""); // selected
  const [specializations, setSpecializations] = useState<string[]>([]); // list

  const [qualification, setQualification] = useState<string[]>([]); // selected
  const [qualifications, setQualifications] = useState<string[]>([]); // list

  const [existingDoctor, setExistingDoctor] = useState(false);
  const [loading, setLoading] = useState(false);

  // GET DOCTOR INFO
  useEffect(() => {
    const handleGetInfo = async () => {
      try {
        setLoading(true);

        const response = await fetch("/api/doctor/info");
        const data = await response.json();

        if (response.ok) {
          setExistingDoctor(true);
          setFees(data.fees);
          setExperience(data.experience);
          setSpecialization(data.specialization);
          setQualification(data.qualifications);
        }
      } catch (err:any) {
        console.error("Doctor not created yet.");
      } finally {
        setLoading(false);
      }
    };

    handleGetInfo();
  }, []);

  // GET ENUM VALUES (qualifications, specializations)
  useEffect(() => {
    const fetchEnums = async () => {
      try {
        const sp = await fetch("/api/doctor/specializations");
        const spData = await sp.json();
        if (sp.ok) setSpecializations(spData.specializations);

        const q = await fetch("/api/doctor/qualifications");
        const qData = await q.json();
        if (q.ok) setQualifications(qData.qualifications);
      } catch (err:any) {
        console.error("Enum fetch error:"+ err.message);
      }
    };

    fetchEnums();
  }, []);

  // UPDATE DOCTOR INFO
  const handleUpdateInfo = async () => {
    try {
      setLoading(true);

      const response = await fetch("/api/doctor/info", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fees,
          specialization,
          experience,
          qualifications: qualification,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        alert("Doctor info updated successfully.");
      } else {
        alert("Error updating doctor info: " + data.error);
      }
    } catch (err:any) {
      alert("Error updating doctor info: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // CREATE DOCTOR INFO
  const handleCreateInfo = async () => {
    try {
      setLoading(true);

      const response = await fetch("/api/doctor/info", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fees,
          specialization,
          experience,
          qualifications: qualification,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setExistingDoctor(true);
        alert("Doctor info created successfully.");
      } else {
        alert("Error creating doctor info: " + data.error);
      }
    } catch (err:any) {
      alert("Create error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg mt-6">

      <h2 className="text-2xl font-bold mb-4 text-center">
        Doctor Information
      </h2>

      {loading && <p className="text-blue-600">Loading...</p>}

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

      {/* SPECIALIZATION — SINGLE SELECT */}
      <label className="block font-semibold mt-3">Specialization:</label>
      <select
        value={specialization}
        onChange={(e) => setSpecialization(e.target.value)}
        className="w-full border p-2 rounded"
      >
        <option value="">Select specialization</option>
        {specializations.map((sp: string) => (
          <option key={sp} value={sp}>
            {sp}
          </option>
        ))}
      </select>

      {/* QUALIFICATIONS — MULTIPLE SELECT */}
      <label className="block font-semibold mt-3">Qualifications:</label>
     <select
  multiple
  value={qualification}
  onChange={(e) =>
    setQualification(
      Array.from(
        (e.target as HTMLSelectElement).selectedOptions,
        (option) => option.value
      )
    )
  }
  className="w-full border p-2 rounded h-32"
>
  {qualifications.map((q: string) => (
    <option key={q} value={q}>
      {q}
    </option>
  ))}
</select>


      {/* BUTTONS */}
      <div className="mt-6 flex justify-between">
        {!existingDoctor ? (
          <button
            className="px-4 py-2 bg-green-600 text-white rounded"
            onClick={handleCreateInfo}
          >
            Create Info
          </button>
        ) : (
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded"
            onClick={handleUpdateInfo}
          >
            Update Info
          </button>
        )}
      </div>
    </div>
  );
}
