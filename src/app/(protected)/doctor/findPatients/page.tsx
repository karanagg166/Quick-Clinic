"use client";

import { useState } from "react";
import PatientCard from "@/components/patient/patientCard";
import type { Patient } from "@/types/patient";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

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
      if (gender && gender !== "all") params.append("gender", gender);
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
    <div className="min-h-screen p-6 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-semibold mb-2">Find Patients</h1>
        <p className="text-muted-foreground">Search patient records using flexible filters</p>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Search Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <Input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
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
              placeholder="Age"
              value={age}
              onChange={(e) => setAge(e.target.value)}
            />
            <Input
              type="text"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
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

      {/* Results */}
      <div>
        {loading && (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}

        {!loading && searched && patients.length === 0 && (
          <Card>
            <CardContent className="p-6 text-center">
              <p className="text-muted-foreground">No patients found.</p>
            </CardContent>
          </Card>
        )}

        {!loading && patients.length > 0 && (
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