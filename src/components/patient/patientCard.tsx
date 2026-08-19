"use client";

import { useState } from "react";
import type { Patient } from "@/types/patient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import Avatar from "@/components/general/Avatar";
import { ChevronDown, Calendar, FileText, Clock } from "lucide-react";

export default function PatientCard({ patient }: { patient: Patient }) {
  const [showAppointments, setShowAppointments] = useState(false);
  const appointments = patient.appointments || [];

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case "COMPLETED":
        return "bg-emerald-100 text-emerald-800 border-emerald-300";
      case "CONFIRMED":
        return "bg-blue-100 text-blue-800 border-blue-300";
      case "CANCELLED":
        return "bg-rose-100 text-rose-800 border-rose-300";
      case "NO_SHOW":
        return "bg-amber-100 text-amber-800 border-amber-300";
      default:
        return "bg-gray-100 text-gray-800 border-gray-300";
    }
  };

  return (
    <Card className="hover:shadow-md transition-shadow border">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-4">
          <Avatar 
            src={patient.profileImageUrl} 
            name={patient.name}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold truncate text-foreground">{patient.name}</h2>
            <p className="text-xs text-muted-foreground truncate">{patient.email}</p>
            {patient.phoneNo && (
              <p className="text-xs text-muted-foreground mt-0.5">{patient.phoneNo}</p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <Separator />
        
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <span className="text-muted-foreground">Age: </span>
            <span className="font-semibold text-foreground">{patient.age} yrs</span>
          </div>
          <div>
            <span className="text-muted-foreground">Gender: </span>
            <span className="font-semibold text-foreground">{patient.gender}</span>
          </div>
          {(patient.city || patient.state) && (
            <div className="col-span-2">
              <span className="text-muted-foreground">Location: </span>
              <span className="font-medium text-foreground">
                {[patient.city, patient.state].filter(Boolean).join(", ")}
              </span>
            </div>
          )}
        </div>

        <Separator />

        <div className="space-y-2 text-xs">
          <div>
            <span className="font-semibold text-foreground">Medical History:</span>
            <p className="text-muted-foreground mt-0.5">
              {Array.isArray(patient.medicalHistory) ? patient.medicalHistory.join(", ") : patient.medicalHistory || "None"}
            </p>
          </div>
          <div>
            <span className="font-semibold text-foreground">Allergies:</span>
            <p className="text-muted-foreground mt-0.5">
              {Array.isArray(patient.allergies) ? patient.allergies.join(", ") : patient.allergies || "None"}
            </p>
          </div>
          <div>
            <span className="font-semibold text-foreground">Current Medications:</span>
            <p className="text-muted-foreground mt-0.5">
              {Array.isArray(patient.currentMedications) ? patient.currentMedications.join(", ") : patient.currentMedications || "None"}
            </p>
          </div>
        </div>

        {/* Appointment History Section */}
        <Separator />
        
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAppointments(!showAppointments)}
            className="w-full justify-between px-2 py-1.5 h-auto text-xs font-semibold text-primary hover:bg-primary/10"
          >
            <span className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              Appointment History ({appointments.length})
            </span>
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform duration-200 ${
                showAppointments ? "rotate-180" : ""
              }`}
            />
          </Button>

          {showAppointments && (
            <div className="mt-2 space-y-2 pt-1">
              {appointments.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">
                  No appointments on record with this doctor.
                </p>
              ) : (
                appointments.map((appt) => (
                  <div
                    key={appt.id}
                    className="p-2.5 rounded border bg-muted/30 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${getStatusBadgeVariant(appt.status)}`}>
                        {appt.status}
                      </span>
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {appt.slot?.date || new Date(appt.bookedAt).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="text-[11px] text-muted-foreground">
                      Type: <span className="font-medium text-foreground">{appt.isAppointmentOffline ? "Offline / In-Person" : "Online Video"}</span> ({appt.paymentMethod})
                    </div>

                    {appt.notes ? (
                      <div className="bg-background p-1.5 rounded border text-[11px]">
                        <span className="font-semibold text-foreground flex items-center gap-1">
                          <FileText className="w-3 h-3 text-muted-foreground" />
                          Notes:
                        </span>
                        <p className="text-muted-foreground mt-0.5">{appt.notes}</p>
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground italic">No clinical notes recorded.</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
