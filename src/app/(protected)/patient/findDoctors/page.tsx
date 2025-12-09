"use client";

import { useEffect, useState } from "react";
import DoctorCard from "@/components/doctor/doctorCard";
import type { Doctor } from "@/types/doctor"; // optional: create this type file




export default function FindDoctorsPage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [name, setName] = useState("");
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [gender, setGender] = useState("");

  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [specializations, setSpecializations] = useState<string[]>([]);

  // Fetch specializations on mount
  useEffect(() => {
    let mounted = true;

    const fetchSpecializations = async () => {
      try {
        const res = await fetch("/api/doctors/specializations");
        if (!res.ok) {
          console.error("Failed to fetch specializations:", res.status);
          return;
        }
        const data = await res.json();
        if (mounted) {
          // adjust to the shape your API returns; fallback to empty array
          setSpecializations(data.specialties ?? data.specializations ?? []);
        }
      } catch (error) {
        console.error("Error fetching specializations:", error);
      }
    };

    fetchSpecializations();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);

    try {
      const params = new URLSearchParams();
      if (city) params.append("city", city);
      if (state) params.append("state", state);
      if (specialty) params.append("specialization", specialty);
      if (gender) params.append("gender", gender);
      if (name) params.append("name", name);
      if (fees) params.append("fees", fees);
      if (experience) params.append("experience", experience);
    // console.log("Fetching doctors with params:", params.toString());
      const res = await fetch(`/api/doctors?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });
    console.log("Response status:", res);
      if (res.ok) {
        const data = await res.json();
        // if API returns { doctors: [...] } adjust accordingly
        setDoctors(Array.isArray(data) ? data : data.doctors ?? []);
      } else {
        console.error("Failed to fetch doctors:", res);
        setDoctors([]);
      }
    } catch (error) {
      console.error("Error fetching doctors:", error);
      setDoctors([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Find Your Preferred Doctor</h1>
        <p className="text-gray-600">Search and book appointments with qualified healthcare professionals</p>
      </div>

      {/* Search Filters */}
      <div className="bg-white p-6 rounded-lg shadow-md mb-8">
        <h2 className="text-2xl font-semibold mb-4">Search Filters</h2>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
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

          <input
            type="text"
            placeholder="Doctor Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <select
            value={specialty}
            onChange={(e) => setSpecialty(e.target.value)}
            className="border p-2 rounded w-full"
          >
            <option value="">All Specializations</option>
            {specializations.map((spec) => (
              <option key={spec} value={spec}>
                {spec}
              </option>
            ))}
          </select>

          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className="border p-2 rounded w-full"
          >
            <option value="">All Genders</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            {/* use BINARY or OTHER depending on your backend */}
            <option value="BINARY">Other</option>
          </select>

          <input
            type="number"
            placeholder="Max Fees"
            value={fees}
            onChange={(e) => setFees(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <input
            type="number"
            placeholder="Min Experience (years)"
            value={experience}
            onChange={(e) => setExperience(e.target.value)}
            className="border p-2 rounded w-full"
          />

          <button
            onClick={handleSearch}
            className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 transition-colors w-full"
          >
            {loading ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Doctors List */}
      <div>
        {loading && <div className="text-gray-600 mb-4">Loading...</div>}

        {!loading && searched && doctors.length === 0 && (
          <div className="text-gray-600 mb-4">No doctors found for the selected filters.</div>
        )}

        {doctors.length > 0 && (
          <>
            <h2 className="text-2xl font-semibold mb-4">Search Results</h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {doctors.map((doctor) => (
                <DoctorCard key={doctor.id} doctor={doctor} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
