"use client";

import { useState, useEffect } from "react";
import { useRouter} from "next/navigation";
import { useUserStore } from "@/store/userStore";
export default function DoctorDetails() {
  const router = useRouter();
  const userId = useUserStore((state) => state.user?.userId);
  const user = useUserStore((state) => state.user);
  const setUser = useUserStore((state) => state.setUser);
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");
  

  const [specialty, setSpecialty] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);

  const [qualification, setQualification] = useState<string[]>([]);
  const [qualifications, setQualifications] = useState<string[]>([]);

  const [loading, setLoading] = useState(false); // button loading
  const [enumLoading, setEnumLoading] = useState(true); // loading enums
  
  const getUser = useUserStore((state) => state.user);
  
   
  // Toggle qualification
  const toggleQualification = (value: string) => {
    setQualification((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    );
  };

  // ============================
  //  Fetch Enum Lists (GET)
  // ============================
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
        console.error("Enum fetch error: " + err.message);
      } finally {
        setEnumLoading(false);
      }
    };

    fetchEnums();
  }, []);

  // ============================
  //  CREATE Doctor Info (POST)
  // ============================
  const handleCreateInfo = async () => {
    if (!userId || Array.isArray(userId)) {
      alert("Missing user id from URL.");
      return;
    }

    // Basic Validation
    if (!fees || !experience || !specialty) {
      alert("Please fill all required fields.");
      return;
    }

    try {
      setLoading(true);
      console.log("user context api",getUser);

      const response = await fetch("/api/doctors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          fees: Number(fees),
          specialty,
          experience: Number(experience),
          qualifications: qualification,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Update store with doctorId
        if (user) {
          setUser(user, undefined, data.doctor.id);
        }
        alert("Doctor info created successfully.");
        router.push(`/doctor`);
      } else {
        alert("Error creating doctor info: " + data.error);
      }

    } catch (err: any) {
      alert("Create error: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  // ============================
  //  UI
  // ============================
  return (
    <div className="max-w-lg mx-auto p-6 bg-white shadow-md rounded-lg mt-6">
      
      <h2 className="text-2xl font-bold mb-4 text-center">
        Doctor Information
      </h2>

      {/* Loading for ENUM fetch */}
      {enumLoading && (
        <p className="text-blue-600 text-sm mb-4 animate-pulse">
          Loading doctor fields...
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
        {qualifications.length > 0 ? (
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
          ))
        ) : (
          <p className="text-gray-500 text-sm">Loading qualifications...</p>
        )}
      </div>

      {/* BUTTON */}
      <div className="mt-6 flex justify-end">
        <button
          className={`px-4 py-2 rounded text-white transition ${
            loading
              ? "bg-gray-500 cursor-not-allowed"
              : "bg-green-600 hover:bg-green-700"
          }`}
          onClick={handleCreateInfo}
          disabled={loading}
        >
          {loading ? "Saving..." : "Create Info"}
        </button>
      </div>
    </div>
  );
}