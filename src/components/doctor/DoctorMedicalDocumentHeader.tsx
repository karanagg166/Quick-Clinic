"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Avatar from "@/components/general/Avatar";
import { ArrowLeft, ShieldCheck, CalendarCheck } from "lucide-react";

export interface PatientSummary {
  id: string;
  name: string;
  age?: number | null;
  gender?: string | null;
  profileImageUrl?: string | null;
  qualifyingAppointment?: {
    id: string;
    status: string;
    date?: string;
  };
}

export interface AccessiblePatient {
  id: string;
  name: string;
  age?: number | null;
  gender?: string | null;
  relationship: string;
}

interface DoctorMedicalDocumentHeaderProps {
  patient: PatientSummary | null;
  accessiblePatients: AccessiblePatient[];
  currentPatientId: string;
  onPatientSwitch: (newId: string) => void;
  labCount: number;
  scanCount: number;
  rxCount: number;
}

export function DoctorMedicalDocumentHeader({
  patient,
  accessiblePatients,
  currentPatientId,
  onPatientSwitch,
  labCount,
  scanCount,
  rxCount,
}: DoctorMedicalDocumentHeaderProps) {
  return (
    <div className="space-y-4">
      {/* Top Navigation & Patient Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild className="gap-1.5">
            <Link href="/doctor/patients">
              <ArrowLeft className="w-4 h-4" /> Patient Roster
            </Link>
          </Button>

          {accessiblePatients.length > 1 && (
            <Select value={currentPatientId} onValueChange={onPatientSwitch}>
              <SelectTrigger className="w-[220px] text-xs h-8">
                <SelectValue placeholder="Switch Patient" />
              </SelectTrigger>
              <SelectContent>
                {accessiblePatients.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.name} ({p.relationship})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-lg border">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span>Authorized Clinical Access (Read-Only)</span>
        </div>
      </div>

      {/* Patient Header Banner */}
      <Card className="border shadow-xs bg-card">
        <CardContent className="p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <Avatar
                src={patient?.profileImageUrl}
                name={patient?.name || "Patient"}
                size="lg"
              />
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-foreground">
                    {patient?.name || "Patient Records"}
                  </h1>
                  {patient?.qualifyingAppointment && (
                    <Badge variant="secondary" className="text-[10px] gap-1 font-semibold">
                      <CalendarCheck className="w-3 h-3 text-primary" />
                      {patient.qualifyingAppointment.status} Appointment
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {patient?.gender || "Patient"} • {patient?.age ? `${patient.age} yrs` : "Age not specified"}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 border-t md:border-t-0 md:border-l pt-3 md:pt-0 md:pl-5">
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">Lab Reports</p>
                <p className="text-lg font-bold text-foreground">{labCount}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">Scans</p>
                <p className="text-lg font-bold text-foreground">{scanCount}</p>
              </div>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">Prescriptions</p>
                <p className="text-lg font-bold text-foreground">{rxCount}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
