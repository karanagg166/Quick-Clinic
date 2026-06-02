"use client";

import { useEffect, useState } from "react";
import DoctorCard from "@/components/doctor/doctorCard";
import type { Doctor } from "@/types/doctor";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";




export default function FindDoctorsPage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [name, setName] = useState("");
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
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

  const handleSearch = async (overrideFilters?: {
    city?: string;
    state?: string;
    specialty?: string;
    gender?: string;
    name?: string;
    fees?: string;
    experience?: string;
    age?: string;
  }) => {
    setLoading(true);
    setSearched(true);

    try {
      const params = new URLSearchParams();
      const actualCity = overrideFilters ? (overrideFilters.city ?? "") : city;
      const actualState = overrideFilters ? (overrideFilters.state ?? "") : state;
      const actualSpecialty = overrideFilters ? (overrideFilters.specialty ?? "") : specialty;
      const actualGender = overrideFilters ? (overrideFilters.gender ?? "") : gender;
      const actualName = overrideFilters ? (overrideFilters.name ?? "") : name;
      const actualFees = overrideFilters ? (overrideFilters.fees ?? "") : fees;
      const actualExperience = overrideFilters ? (overrideFilters.experience ?? "") : experience;
      const actualAge = overrideFilters ? (overrideFilters.age ?? "") : age;

      if (actualCity) params.append("city", actualCity);
      if (actualState) params.append("state", actualState);
      if (actualSpecialty && actualSpecialty !== "all") params.append("specialization", actualSpecialty);
      if (actualGender && actualGender !== "all") params.append("gender", actualGender);
      if (actualName) params.append("name", actualName);
      if (actualFees) params.append("fees", actualFees);
      if (actualExperience) params.append("experience", actualExperience);
      if (actualAge) params.append("age", actualAge);
      // console.log("Fetching doctors with params:", params.toString());
      const res = await fetch(`/api/doctors?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });
      console.log("Response status:", res);
      if (res.ok) {
        const data = await res.json();
        // if API returns { doctors: [...] } adjust accordingly
        console.log(data);

        const doctorsData = Array.isArray(data) ? data : data.doctors ?? [];

        console.log(doctorsData);


        setDoctors(doctorsData);
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

  // Load doctors on mount
  useEffect(() => {
    handleSearch();
  }, []);

  const handleClear = () => {
    setCity("");
    setState("");
    setName("");
    setFees("");
    setExperience("");
    setSpecialty("");
    setGender("");
    setAge("");
    handleSearch({
      city: "",
      state: "",
      specialty: "",
      gender: "",
      name: "",
      fees: "",
      experience: "",
      age: "",
    });
  };

  return (
    <div className="min-h-screen p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold mb-2">Find Your Preferred Doctor</h1>
        <p className="text-muted-foreground">Search and book appointments with qualified healthcare professionals</p>
      </div>

      {/* Search Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Search Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <Input
              type="text"
              placeholder="City"
              value={city}
              onChange={(e) => setCity(e.target.value)}
            />
            <Input
              type="text"
              placeholder="State"
              value={state}
              onChange={(e) => setState(e.target.value)}
            />
            <Input
              type="text"
              placeholder="Doctor Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Select value={specialty} onValueChange={setSpecialty}>
              <SelectTrigger>
                <SelectValue placeholder="All Specializations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Specializations</SelectItem>
                {specializations.map((spec) => (
                  <SelectItem key={spec} value={spec}>
                    {spec.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger>
                <SelectValue placeholder="All Genders" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Genders</SelectItem>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="BINARY">Other</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="Max Fees"
              value={fees}
              onChange={(e) => setFees(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Min Experience (years)"
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Age"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
            <div className="flex gap-2 w-full col-span-1">
              <Button
                onClick={() => handleSearch()}
                className="flex-1"
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </Button>
              <Button
                onClick={handleClear}
                variant="outline"
                disabled={loading}
              >
                Clear
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Doctors List */}
      <div>
        {loading && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {!loading && searched && doctors.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">No doctors found for the selected filters.</p>
            </CardContent>
          </Card>
        )}

        {!loading && doctors.length > 0 && (
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
