"use client";

import { useState } from "react";
import PatientCard from "@/components/patient/patientCard";
import type { Patient } from "@/types/patient";
import { useUserStore } from "@/store/userStore";

export default function FindPatientsPage() {
  const doctorId = useUserStore((s) => s.doctorId); // ✅ FIXED

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);

    try {
      const params = new URLSearchParams();
      params.append("doctorId", doctorId || "");

      if (name) params.append("name", name);
      if (gender) params.append("gender", gender);
      if (age) params.append("age", age);
      if (email) params.append("email", email);
      if (city) params.append("city", city);
      if (state) params.append("state", state);

      const res = await fetch(`/api/patients?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
console.log(data);
        // Make sure medical arrays always exist
        const safePatients = (Array.isArray(data) ? data : data.patients ?? []).map((p: any) => ({
          ...p,
          medicalHistory: p.medicalHistory ?? [],
          allergies: p.allergies ?? [],
          currentMedications: p.currentMedications ?? [],
        }));

        setPatients(safePatients);
      } else {
        console.error("Failed to fetch patients");
        setPatients([]);
      }
    } catch (error) {
      console.error("Error fetching patients:", error);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Find Patients</h1>
        <p className="text-gray-600">Search patient records using flexible filters</p>
      </div>

      {/* Filters */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-2xl font-semibold mb-4">Search Filters</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">

          <input
            type="text"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="border p-2 rounded w-full"
          >
            <option value="">All Genders</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="BINARY">Other</option>
          </select>

          <input
            type="number"
            placeholder="Age"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <input
            type="text"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <input
            type="text"
            placeholder="City"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <input
            type="text"
            placeholder="State"
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <button
            onClick={handleSearch}
            className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 transition w-full"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Results */}
      <div>
        {loading && <p className="text-gray-600">Loading...</p>}

        {!loading && searched && patients.length === 0 && (
          <p className="text-gray-600">No patients found.</p>
        )}

        {patients.length > 0 && (
          <>
            <h2 className="text-2xl font-semibold mb-4">Search Results</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {patients.map((patient) => (
                <PatientCard key={patient.id} patient={patient} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
