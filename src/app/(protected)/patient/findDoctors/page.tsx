"use client";

import { useEffect, useState } from "react";
import DoctorCard from "@/components/doctor/doctorCard";
import type { Doctor } from "@/types/doctor";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";




import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function FindDoctorsPage() {
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [name, setName] = useState("");
  const [minFees, setMinFees] = useState("");
  const [maxFees, setMaxFees] = useState("");
  const [minExperience, setMinExperience] = useState("");
  const [maxExperience, setMaxExperience] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [gender, setGender] = useState("");
  const [age, setAge] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [distanceUnavailable, setDistanceUnavailable] = useState(false);
  const [requestingLocation, setRequestingLocation] = useState(false);

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
    minFees?: string;
    maxFees?: string;
    minExperience?: string;
    maxExperience?: string;
    age?: string;
  }, coordinates?: { latitude: number; longitude: number }) => {
    setLoading(true);
    setSearched(true);

    try {
      const params = new URLSearchParams();
      const actualCity = overrideFilters ? (overrideFilters.city ?? "") : city;
      const actualState = overrideFilters ? (overrideFilters.state ?? "") : state;
      const actualSpecialty = overrideFilters ? (overrideFilters.specialty ?? "") : specialty;
      const actualGender = overrideFilters ? (overrideFilters.gender ?? "") : gender;
      const actualName = overrideFilters ? (overrideFilters.name ?? "") : name;
      const actualMinFees = overrideFilters ? (overrideFilters.minFees ?? "") : minFees;
      const actualMaxFees = overrideFilters ? (overrideFilters.maxFees ?? "") : maxFees;
      const actualMinExperience = overrideFilters ? (overrideFilters.minExperience ?? "") : minExperience;
      const actualMaxExperience = overrideFilters ? (overrideFilters.maxExperience ?? "") : maxExperience;
      const actualAge = overrideFilters ? (overrideFilters.age ?? "") : age;

      if (actualCity) params.append("city", actualCity);
      if (actualState) params.append("state", actualState);
      if (actualSpecialty && actualSpecialty !== "all") params.append("specialization", actualSpecialty);
      if (actualGender && actualGender !== "all") params.append("gender", actualGender);
      if (actualName) params.append("name", actualName);
      if (actualMinFees) params.append("minFees", actualMinFees);
      if (actualMaxFees) params.append("maxFees", actualMaxFees);
      if (actualMinExperience) params.append("minExperience", actualMinExperience);
      if (actualMaxExperience) params.append("maxExperience", actualMaxExperience);
      if (actualAge) params.append("age", actualAge);
      if (coordinates) {
        params.append("lat", String(coordinates.latitude));
        params.append("lng", String(coordinates.longitude));
      }
      const res = await fetch(`/api/doctors?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        const doctorsData = Array.isArray(data) ? data : data.doctors ?? [];

        setDoctors(doctorsData);
        setDistanceUnavailable(Boolean(!Array.isArray(data) && data.distanceUnavailable));
      } else {
        console.error("Failed to fetch doctors:", res);
        setDoctors([]);
        setDistanceUnavailable(Boolean(coordinates));
      }
    } catch (error) {
      console.error("Error fetching doctors:", error);
      setDoctors([]);
      setDistanceUnavailable(Boolean(coordinates));
    } finally {
      setLoading(false);
    }
  };

  const handleNearbySearch = () => {
    if (!navigator.geolocation) {
      showToast.error("Geolocation is not supported by your browser.");
      setDistanceUnavailable(true);
      void handleSearch().then(() => setDistanceUnavailable(true));
      return;
    }

    setRequestingLocation(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setRequestingLocation(false);
        showToast.success("Location acquired. Finding doctors near you...");
        void handleSearch(undefined, {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (geoError) => {
        setRequestingLocation(false);
        setDistanceUnavailable(true);
        let msg = "Could not get your location. Please check browser permissions or search by city/state.";
        if (geoError.code === geoError.PERMISSION_DENIED) {
          msg = "Location access was denied. Please allow location permissions in your browser or search by city.";
        } else if (geoError.code === geoError.TIMEOUT) {
          msg = "Location request timed out. Please try again or search by city.";
        }
        showToast.error(msg);
        void handleSearch().then(() => setDistanceUnavailable(true));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  };

  // Load doctors on mount
  useEffect(() => {
    handleSearch();
  }, []);

  const handleClear = () => {
    setCity("");
    setState("");
    setName("");
    setMinFees("");
    setMaxFees("");
    setMinExperience("");
    setMaxExperience("");
    setSpecialty("");
    setGender("");
    setAge("");
    setDistanceUnavailable(false);
    handleSearch({
      city: "",
      state: "",
      specialty: "",
      gender: "",
      name: "",
      minFees: "",
      maxFees: "",
      minExperience: "",
      maxExperience: "",
      age: "",
    });
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/patient">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold mb-2">Find Your Preferred Doctor</h1>
        <p className="text-sm text-muted-foreground">Search and book appointments with qualified healthcare professionals</p>
      </div>

      {/* Search Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Search Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
              placeholder="Min Fees"
              value={minFees}
              onChange={(e) => setMinFees(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Max Fees"
              value={maxFees}
              onChange={(e) => setMaxFees(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Min Experience (years)"
              value={minExperience}
              onChange={(e) => setMinExperience(e.target.value)}
            />
            <Input
              type="number"
              placeholder="Max Experience (years)"
              value={maxExperience}
              onChange={(e) => setMaxExperience(e.target.value)}
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
            <Button
              onClick={handleNearbySearch}
              variant="secondary"
              disabled={loading || requestingLocation}
              className="w-full"
            >
              {requestingLocation ? "Getting your location..." : "Find doctors near me"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Doctors List */}
      <div>
        {distanceUnavailable && (
          <Card className="mb-4 border-amber-300 bg-amber-50">
            <CardContent className="p-4 text-sm text-amber-900">
              Distance and travel time are unavailable. Showing doctors that match your filters instead.
            </CardContent>
          </Card>
        )}
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
