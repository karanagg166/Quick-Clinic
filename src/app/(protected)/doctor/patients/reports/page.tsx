"use client";

import { Suspense, useEffect, useState, useCallback, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";
import type { Patient } from "@/types/patient";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import Avatar from "@/components/general/Avatar";
import {
  FileText,
  Printer,
  ChevronLeft,
  Search,
  AlertTriangle,
  HeartPulse,
  Pill,
  Calendar,
  Clock,
  User,
  MapPin,
  Phone,
  Mail,
  ShieldAlert,
  CheckCircle2,
  Share2,
  Stethoscope,
  Building2,
  MessageSquare
} from "lucide-react";

function DoctorPatientReportsContent() {
  const searchParams = useSearchParams();
  const initialPatientId = searchParams.get("patientId");

  const doctorId = useUserStore((s) => s.doctorId);
  const user = useUserStore((s) => s.user);

  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(initialPatientId || null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isPending, startTransition] = useTransition();

  const fetchPatients = useCallback(async () => {
    if (!doctorId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/patients?doctorId=${doctorId}&scope=all`, {
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

        if (!selectedPatientId && safePatients.length > 0) {
          setSelectedPatientId(safePatients[0].id);
        }
      } else {
        setPatients([]);
      }
    } catch (err) {
      console.error("Failed to load patient reports data:", err);
      showToast.error("Failed to load patients for reports");
    } finally {
      setLoading(false);
    }
  }, [doctorId, selectedPatientId]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  // Update selected if query param changes
  useEffect(() => {
    if (initialPatientId) {
      setSelectedPatientId(initialPatientId);
    }
  }, [initialPatientId]);

  const filteredPatients = patients.filter((p) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q) ||
      (p.phoneNo && p.phoneNo.includes(q))
    );
  });

  const selectedPatient = patients.find((p) => p.id === selectedPatientId) || patients[0] || null;

  const handlePrint = () => {
    window.print();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300";
      case "CONFIRMED":
        return "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300";
      case "CANCELLED":
        return "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300";
      case "NO_SHOW":
        return "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const allergiesStr = selectedPatient
    ? Array.isArray(selectedPatient.allergies)
      ? selectedPatient.allergies.join(", ")
      : selectedPatient.allergies || "None reported"
    : "";

  const hasAllergies = selectedPatient && allergiesStr !== "None reported" && allergiesStr !== "None" && allergiesStr !== "";

  const medHistoryStr = selectedPatient
    ? Array.isArray(selectedPatient.medicalHistory)
      ? selectedPatient.medicalHistory.join(", ")
      : selectedPatient.medicalHistory || "None reported"
    : "";

  const currentMedsStr = selectedPatient
    ? Array.isArray(selectedPatient.currentMedications)
      ? selectedPatient.currentMedications.join(", ")
      : selectedPatient.currentMedications || "None recorded"
    : "";

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8 animate-fade-in print:p-0 print:m-0 print:max-w-full">
      {/* Top Bar (Hidden in Print) */}
      <div className="flex items-center justify-between print:hidden">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/doctor/patients">
            <ChevronLeft className="w-4 h-4" /> Back to Patients
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            disabled={!selectedPatient}
            className="gap-1.5 text-xs font-semibold shadow-xs"
          >
            <Printer className="w-3.5 h-3.5 text-primary" /> Print / Export Report
          </Button>
          <Button variant="default" size="sm" asChild className="gap-1.5 text-xs font-semibold shadow-xs">
            <Link href="/doctor/chat">
              <MessageSquare className="w-3.5 h-3.5" /> Message Patient
            </Link>
          </Button>
        </div>
      </div>

      {/* Header (Hidden in Print) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 print:hidden">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <FileText className="w-7 h-7 text-primary" />
            Patient Clinical & Medical Reports
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate, review, and print comprehensive medical reports, consultation histories, and health summaries.
          </p>
        </div>
      </div>

      {/* Main Layout Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Patient Selector (Hidden in Print) */}
        <Card className="lg:col-span-4 border shadow-xs print:hidden">
          <CardHeader className="p-4 pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <User className="w-4 h-4 text-primary" /> Select Patient
            </CardTitle>
            <CardDescription className="text-xs">
              Choose a patient to view full health report
            </CardDescription>
            <div className="relative mt-2">
              <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search patient name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-xs rounded-xl h-9"
              />
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : filteredPatients.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-xs">
                No patients found
              </div>
            ) : (
              <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
                {filteredPatients.map((p) => {
                  const isSelected = selectedPatient?.id === p.id;
                  const pAllergies = Array.isArray(p.allergies) ? p.allergies : [];
                  const pHasAllergies = pAllergies.length > 0 || (typeof p.allergies === "string" && p.allergies !== "None" && p.allergies !== "");

                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPatientId(p.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all flex items-center gap-3 ${
                        isSelected
                          ? "bg-primary/10 border-primary text-foreground ring-1 ring-primary/30"
                          : "hover:bg-muted/50 border-border text-foreground"
                      }`}
                    >
                      <Avatar src={p.profileImageUrl} name={p.name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1">
                          <p className="font-semibold text-xs truncate">{p.name}</p>
                          {pHasAllergies && (
                            <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" title="Allergy Alert" />
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{p.email}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {p.gender || "Patient"} • {p.age || "--"} yrs • {p.appointments?.length || 0} visits
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right Column: Full Clinical Report Card */}
        <div className="lg:col-span-8 space-y-6">
          {!selectedPatient ? (
            <Card className="rounded-2xl border-dashed">
              <CardContent className="p-12 text-center space-y-3">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto" />
                <h3 className="text-base font-semibold text-foreground">No Patient Selected</h3>
                <p className="text-xs text-muted-foreground">
                  Please select a patient from the roster on the left to generate their medical report.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card className="border shadow-md rounded-2xl bg-card overflow-hidden print:border-none print:shadow-none print:p-0">
              {/* Report Header / Clinic Branding */}
              <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-6 border-b flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="w-6 h-6 text-primary" />
                    <span className="font-extrabold text-xl tracking-tight text-foreground">
                      Quick-Clinic
                    </span>
                    <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-wider ml-1">
                      Official Medical Report
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Confidential Clinical Summary & Patient History
                  </p>
                </div>

                <div className="text-left sm:text-right text-xs text-muted-foreground space-y-0.5">
                  <p className="font-semibold text-foreground">
                    Attending: Dr. {user?.name || "Practitioner"}
                  </p>
                  <p>Report Date: {new Date().toLocaleDateString("en-US", { dateStyle: "long" })}</p>
                  <p className="text-[10px] text-muted-foreground">REF: QC-REP-{selectedPatient.id.slice(-6).toUpperCase()}</p>
                </div>
              </div>

              <CardContent className="p-6 space-y-6">
                {/* Patient Profile Demographics */}
                <div className="p-4 rounded-xl bg-muted/40 border grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                      Patient Full Name
                    </span>
                    <span className="text-sm font-bold text-foreground mt-0.5 block">
                      {selectedPatient.name}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                      Age / Gender
                    </span>
                    <span className="text-sm font-bold text-foreground mt-0.5 block">
                      {selectedPatient.age ? `${selectedPatient.age} Years` : "N/A"} • {selectedPatient.gender || "N/A"}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                      Contact Phone / Email
                    </span>
                    <span className="text-xs font-medium text-foreground mt-0.5 block truncate">
                      {selectedPatient.phoneNo || "No phone"}
                    </span>
                    <span className="text-[11px] text-muted-foreground truncate block">
                      {selectedPatient.email}
                    </span>
                  </div>

                  <div>
                    <span className="text-muted-foreground block text-[10px] uppercase font-semibold">
                      Location / Address
                    </span>
                    <span className="text-xs font-medium text-foreground mt-0.5 block">
                      {[selectedPatient.city, selectedPatient.state].filter(Boolean).join(", ") || "Clinic Direct"}
                    </span>
                  </div>
                </div>

                {/* Known Allergies Alert Banner */}
                {hasAllergies ? (
                  <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800 flex items-start gap-3">
                    <ShieldAlert className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div>
                      <h4 className="font-bold text-xs text-rose-800 dark:text-rose-200">
                        CRITICAL MEDICAL ALERT: KNOWN ALLERGIES
                      </h4>
                      <p className="text-xs text-rose-700 dark:text-rose-300 mt-1 font-semibold">
                        {allergiesStr}
                      </p>
                      <p className="text-[10px] text-rose-600/80 dark:text-rose-400/80 mt-0.5">
                        Verify allergy interactions before prescribing or administering medication.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 flex items-center gap-2.5 text-xs text-emerald-800 dark:text-emerald-300 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    No critical allergies or drug adverse reactions reported by patient.
                  </div>
                )}

                {/* Medical History & Current Medications */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl border bg-card space-y-2">
                    <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
                      <HeartPulse className="w-4 h-4 text-rose-500" /> Medical History & Chronic Conditions
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {medHistoryStr}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl border bg-card space-y-2">
                    <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
                      <Pill className="w-4 h-4 text-purple-500" /> Active Medications & Prescriptions
                    </h4>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {currentMedsStr}
                    </p>
                  </div>
                </div>

                {/* Consultation History Breakdown */}
                <div className="space-y-3">
                  <h4 className="font-bold text-xs text-foreground flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-primary" /> Past Consultations & Clinic Visits ({selectedPatient.appointments?.length || 0})
                  </h4>

                  {(!selectedPatient.appointments || selectedPatient.appointments.length === 0) ? (
                    <div className="p-4 rounded-xl border border-dashed text-center text-xs text-muted-foreground">
                      No past consultation logs found for this patient with this doctor.
                    </div>
                  ) : (
                    <div className="overflow-x-auto border rounded-xl">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-muted/50 text-muted-foreground font-semibold border-b text-[11px]">
                          <tr>
                            <th className="p-2.5">Date & Time</th>
                            <th className="p-2.5">Status</th>
                            <th className="p-2.5">Mode</th>
                            <th className="p-2.5">Payment</th>
                            <th className="p-2.5">Clinical Notes</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y text-[11px]">
                          {selectedPatient.appointments.map((appt) => (
                            <tr key={appt.id} className="hover:bg-muted/20">
                              <td className="p-2.5 font-medium whitespace-nowrap">
                                {appt.slot?.date || new Date(appt.bookedAt).toLocaleDateString()}
                              </td>
                              <td className="p-2.5">
                                <span className={`px-2 py-0.5 rounded-full font-semibold text-[10px] ${getStatusColor(appt.status)}`}>
                                  {appt.status}
                                </span>
                              </td>
                              <td className="p-2.5">
                                {appt.isAppointmentOffline ? "In-Person Clinic" : "Online Video"}
                              </td>
                              <td className="p-2.5">
                                {appt.paymentMethod}
                              </td>
                              <td className="p-2.5 text-muted-foreground max-w-xs truncate">
                                {appt.notes || "Standard Consultation"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                {/* Doctor Assessment / Authorization Sign-off */}
                <div className="p-4 rounded-xl bg-muted/20 border space-y-2 text-xs">
                  <h4 className="font-bold text-foreground flex items-center gap-1.5">
                    <Stethoscope className="w-4 h-4 text-primary" /> Doctor Clinical Summary & Advice
                  </h4>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    Patient has been evaluated per standard clinic protocol. Ongoing adherence to prescribed treatments and routine follow-ups are advised. Contact clinic immediately in case of acute flare-ups.
                  </p>
                  <div className="pt-4 flex items-center justify-between text-muted-foreground text-[10px] border-t mt-3">
                    <span>Generated by Quick-Clinic Healthcare EMR</span>
                    <span className="font-semibold text-foreground">Doctor Signature: __________________</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DoctorPatientReportsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-sm text-muted-foreground">Loading patient reports...</div>}>
      <DoctorPatientReportsContent />
    </Suspense>
  );
}
