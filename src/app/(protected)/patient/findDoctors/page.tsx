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

  const handleSearch = async () => {
    setLoading(true);
    setSearched(true);

    try {
      const params = new URLSearchParams();
      if (city) params.append("city", city);
      if (state) params.append("state", state);
      if (specialty && specialty !== "all") params.append("specialization", specialty);
      if (gender && gender !== "all") params.append("gender", gender);
      if (name) params.append("name", name);
      if (fees) params.append("fees", fees);
      if (experience) params.append("experience", experience);
      if (age) params.append("age", age);
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
                    {spec}
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
            <Button
              onClick={handleSearch}
              className="w-full"
              disabled={loading}
            >
              {loading ? "Searching..." : "Search"}
            </Button>
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
