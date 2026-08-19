"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import PatientCard from "@/components/patient/patientCard";
import type { Patient } from "@/types/patient";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { RotateCcw, Search, ChevronLeft, Users, FileText, Clock } from "lucide-react";

export default function FindPatientsPage() {
  const doctorId = useUserStore((s) => s.doctorId);

  const [name, setName] = useState("");
  const [gender, setGender] = useState("");
  const [minAge, setMinAge] = useState("");
  const [maxAge, setMaxAge] = useState("");
  const [email, setEmail] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");

  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async (isInitial = false) => {
    setLoading(true);
    if (!isInitial) setSearched(true);

    try {
      const params = new URLSearchParams();
      params.append("doctorId", doctorId || "");
      params.append("scope", "all");

      if (name) params.append("name", name);
      if (gender && gender !== "all") params.append("gender", gender);
      if (minAge) params.append("minAge", minAge);
      if (maxAge) params.append("maxAge", maxAge);
      if (email) params.append("email", email);
      if (city) params.append("city", city);
      if (state) params.append("state", state);

      const res = await fetch(`/api/patients?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      if (res.ok) {
        const data = await res.json();
        const safePatients = (Array.isArray(data) ? data : data.patients ?? []).map((p: any) => ({
          ...p,
          medicalHistory: p.medicalHistory ?? [],
          allergies: p.allergies ?? [],
          currentMedications: p.currentMedications ?? [],
        }));

        setPatients(safePatients);
      } else {
        setPatients([]);
      }
    } catch (error) {
      console.error("Error fetching patients:", error);
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [doctorId, name, gender, minAge, maxAge, email, city, state]);

  useEffect(() => {
    if (doctorId) {
      handleSearch(true);
    } else {
      setLoading(false);
    }
  }, [doctorId]);

  const handleReset = () => {
    setName("");
    setGender("");
    setMinAge("");
    setMaxAge("");
    setEmail("");
    setCity("");
    setState("");
    setSearched(false);
    if (doctorId) {
      handleSearch(true);
    }
  };

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8 animate-fade-in">
      {/* Navigation Bar */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/doctor">
            <ChevronLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="text-xs">
            <Link href="/doctor/patients" className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5 text-primary" />
              My Patients
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-xs">
            <Link href="/doctor/patients/reports" className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-primary" />
              Reports
            </Link>
          </Button>
        </div>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
          <Users className="w-7 h-7 text-primary" />
          Find Clinic Patients
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search patient records across the clinic using flexible age range, demographic, and location filters.
        </p>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Search Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <Input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger className="w-full">
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
              placeholder="Min Age (e.g. 18)"
              value={minAge}
              min={0}
              max={150}
              onChange={(e) => setMinAge(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Max Age (e.g. 65)"
              value={maxAge}
              min={0}
              max={150}
              onChange={(e) => setMaxAge(e.target.value)}
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
            <div className="flex gap-2">
              <Button
                onClick={() => handleSearch(false)}
                className="flex-1 flex items-center gap-1.5"
                disabled={loading}
              >
                <Search className="w-4 h-4" />
                {loading ? "Searching..." : "Search"}
              </Button>
              <Button
                variant="outline"
                onClick={handleReset}
                disabled={loading}
                title="Reset filters"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
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
              <p className="text-muted-foreground">No patients found matching your search criteria.</p>
            </CardContent>
          </Card>
        )}

        {!loading && patients.length > 0 && (
          <>
            <h2 className="text-2xl font-semibold mb-4">Search Results ({patients.length})</h2>
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