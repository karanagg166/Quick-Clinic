"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";
import type { Patient } from "@/types/patient";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Avatar from "@/components/general/Avatar";
import {
  Users,
  Search,
  RotateCcw,
  FileText,
  Clock,
  MessageCircle,
  AlertTriangle,
  Pill,
  MapPin,
  ChevronLeft,
  CalendarCheck,
  HeartPulse,
  Activity,
  ArrowRight
} from "lucide-react";

export default function DoctorPatientsPage() {
  const doctorId = useUserStore((s) => s.doctorId);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [genderFilter, setGenderFilter] = useState("all");
  const [scope, setScope] = useState<"my" | "all">("my");

  const fetchPatients = useCallback(async () => {
    if (!doctorId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("doctorId", doctorId);
      if (scope === "all") {
        params.append("scope", "all");
      }

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
          appointments: p.appointments ?? [],
        }));
        setPatients(safePatients);
      } else {
        setPatients([]);
      }
    } catch (error) {
      console.error("Error fetching patients:", error);
      showToast.error("Failed to load patient records");
      setPatients([]);
    } finally {
      setLoading(false);
    }
  }, [doctorId, scope]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  const handleReset = () => {
    setSearchQuery("");
    setGenderFilter("all");
    setScope("my");
  };

  const filteredPatients = patients.filter((patient) => {
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      patient.name.toLowerCase().includes(q) ||
      patient.email.toLowerCase().includes(q) ||
      (patient.phoneNo && patient.phoneNo.includes(q)) ||
      (patient.city && patient.city.toLowerCase().includes(q)) ||
      (typeof patient.medicalHistory === "string" && patient.medicalHistory.toLowerCase().includes(q)) ||
      (Array.isArray(patient.medicalHistory) && patient.medicalHistory.some((m) => m.toLowerCase().includes(q))) ||
      (typeof patient.allergies === "string" && patient.allergies.toLowerCase().includes(q)) ||
      (Array.isArray(patient.allergies) && patient.allergies.some((a) => a.toLowerCase().includes(q)));

    const matchesGender = genderFilter === "all" || patient.gender?.toUpperCase() === genderFilter.toUpperCase();

    return matchesSearch && matchesGender;
  });

  // Calculate quick stats
  const totalPatients = patients.length;
  const patientsWithAllergies = patients.filter((p) => {
    if (Array.isArray(p.allergies)) return p.allergies.length > 0;
    return Boolean(p.allergies && p.allergies !== "None" && p.allergies !== "");
  }).length;
  const patientsOnMedications = patients.filter((p) => {
    if (Array.isArray(p.currentMedications)) return p.currentMedications.length > 0;
    return Boolean(p.currentMedications && p.currentMedications !== "None" && p.currentMedications !== "");
  }).length;
  const totalConsultations = patients.reduce((acc, curr) => acc + (curr.appointments?.length || 0), 0);

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8 animate-fade-in">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/doctor">
            <ChevronLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="text-xs">
            <Link href="/doctor/patients/reports" className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-primary" />
              Patient Reports
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-xs">
            <Link href="/doctor/patients/history" className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-primary" />
              History Logs
            </Link>
          </Button>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <Users className="w-7 h-7 text-primary" />
            My Patients Directory
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Access your patient profiles, clinical history, known allergies, medications, and interaction logs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex p-1 bg-muted rounded-xl border">
            <button
              onClick={() => setScope("my")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                scope === "my"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              My Patients
            </button>
            <button
              onClick={() => setScope("all")}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                scope === "all"
                  ? "bg-card text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All Clinic Patients
            </button>
          </div>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Total {scope === "my" ? "My Patients" : "Patients"}
              </p>
              <p className="text-2xl font-bold mt-1 text-foreground">{totalPatients}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Total Consultations
              </p>
              <p className="text-2xl font-bold mt-1 text-foreground">{totalConsultations}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CalendarCheck className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Allergy Alerts
              </p>
              <p className="text-2xl font-bold mt-1 text-foreground">{patientsWithAllergies}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                On Medications
              </p>
              <p className="text-2xl font-bold mt-1 text-foreground">{patientsOnMedications}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <Pill className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search Bar */}
      <Card className="border shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            <div className="relative md:col-span-2">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search patient by name, email, city, condition, or allergy..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-sm rounded-xl"
              />
            </div>

            <Select value={genderFilter} onValueChange={setGenderFilter}>
              <SelectTrigger className="rounded-xl text-sm">
                <SelectValue placeholder="Gender Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Genders</SelectItem>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="BINARY">Other</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1 rounded-xl text-xs font-semibold gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset Filters
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Patient Cards List */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            Patients Roster ({filteredPatients.length})
          </h2>
          <span className="text-xs text-muted-foreground">
            Showing {filteredPatients.length} of {totalPatients} patients
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Skeleton key={i} className="h-64 w-full rounded-2xl" />
            ))}
          </div>
        ) : filteredPatients.length === 0 ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-12 text-center space-y-4">
              <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                <Users className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No Patients Found</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {patients.length === 0
                  ? scope === "my"
                    ? "You do not have any patient appointments on record yet. You can switch to 'All Clinic Patients' or view your schedule."
                    : "No patients are registered in the system."
                  : "No patients match your search or gender filter criteria."}
              </p>
              <div className="flex justify-center gap-3 pt-2">
                {scope === "my" && patients.length === 0 && (
                  <Button size="sm" onClick={() => setScope("all")}>
                    View All Clinic Patients
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link href="/doctor/today">View Today's Schedule</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPatients.map((patient) => {
              const allergiesStr = Array.isArray(patient.allergies)
                ? patient.allergies.join(", ")
                : patient.allergies || "None";
              const hasAllergies = allergiesStr !== "None" && allergiesStr !== "";

              const medHistoryStr = Array.isArray(patient.medicalHistory)
                ? patient.medicalHistory.join(", ")
                : patient.medicalHistory || "None on record";

              const currentMedsStr = Array.isArray(patient.currentMedications)
                ? patient.currentMedications.join(", ")
                : patient.currentMedications || "None";

              const apptCount = patient.appointments?.length || 0;

              return (
                <Card
                  key={patient.id}
                  className="rounded-2xl border shadow-xs hover:shadow-md transition-all hover:border-primary/50 flex flex-col justify-between overflow-hidden bg-card"
                >
                  <CardHeader className="p-5 pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <Avatar
                          src={patient.profileImageUrl}
                          name={patient.name}
                          size="md"
                        />
                        <div className="min-w-0">
                          <h3 className="font-bold text-base text-foreground truncate">
                            {patient.name}
                          </h3>
                          <p className="text-xs text-muted-foreground truncate">{patient.email}</p>
                          {patient.phoneNo && (
                            <p className="text-xs text-muted-foreground">{patient.phoneNo}</p>
                          )}
                        </div>
                      </div>
                      <Badge variant="secondary" className="text-[10px] font-semibold shrink-0">
                        {patient.gender || "Patient"} • {patient.age || "--"}y
                      </Badge>
                    </div>
                  </CardHeader>

                  <CardContent className="p-5 pt-0 space-y-3.5 text-xs">
                    {/* Location & Visits */}
                    <div className="flex items-center justify-between text-muted-foreground pt-1 border-t">
                      <div className="flex items-center gap-1.5 truncate">
                        <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="truncate">
                          {[patient.city, patient.state].filter(Boolean).join(", ") || "Clinic Visit"}
                        </span>
                      </div>
                      <Badge variant="outline" className="text-[10px] font-medium shrink-0">
                        {apptCount} Visit{apptCount !== 1 ? "s" : ""}
                      </Badge>
                    </div>

                    {/* Medical details badges */}
                    <div className="space-y-2 bg-muted/30 p-2.5 rounded-xl border">
                      <div>
                        <span className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                          <HeartPulse className="w-3 h-3 text-rose-500" />
                          Medical History:
                        </span>
                        <p className="text-muted-foreground text-[11px] truncate mt-0.5">
                          {medHistoryStr}
                        </p>
                      </div>

                      {hasAllergies ? (
                        <div>
                          <span className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1 text-[11px]">
                            <AlertTriangle className="w-3 h-3" />
                            Allergies:
                          </span>
                          <p className="text-rose-700 dark:text-rose-300 font-medium text-[11px] truncate mt-0.5">
                            {allergiesStr}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <span className="font-semibold text-foreground text-[11px]">Allergies:</span>
                          <span className="text-muted-foreground text-[11px] ml-1">None reported</span>
                        </div>
                      )}

                      <div>
                        <span className="font-semibold text-foreground flex items-center gap-1 text-[11px]">
                          <Pill className="w-3 h-3 text-purple-500" />
                          Medications:
                        </span>
                        <p className="text-muted-foreground text-[11px] truncate mt-0.5">
                          {currentMedsStr}
                        </p>
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-1 border-t">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="rounded-xl text-xs font-semibold gap-1"
                      >
                        <Link href={`/doctor/patients/reports?patientId=${patient.id}`}>
                          <FileText className="w-3.5 h-3.5 text-primary" /> Report
                        </Link>
                      </Button>

                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="rounded-xl text-xs font-semibold gap-1"
                      >
                        <Link href={`/doctor/patients/history?patientId=${patient.id}`}>
                          <Clock className="w-3.5 h-3.5 text-amber-600" /> History
                        </Link>
                      </Button>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        asChild
                        size="sm"
                        className="w-full rounded-xl text-xs font-semibold gap-1.5 shadow-xs"
                      >
                        <Link href={`/doctor/chat`}>
                          <MessageCircle className="w-3.5 h-3.5" /> Message Patient
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
