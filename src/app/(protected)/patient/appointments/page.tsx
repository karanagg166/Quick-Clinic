"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import AppointmentCard from "@/components/patient/appointmentCard";
import type { PatientAppointment } from "@/types/patient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function PatientAppointmentsPage() {
  const patientId = useUserStore((s) => s.patientId);

  const [appointments, setAppointments] = useState<PatientAppointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [fees, setFees] = useState<number | undefined>(undefined);
  const [doctorName, setDoctorName] = useState("");
  const [specialty, setSpecialty] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");

  const fetchAppointments = async () => {
    if (!patientId) return;

    setLoading(true);

    const params = new URLSearchParams();

    if (doctorName) params.append("doctorName", doctorName);
    if (fees !== undefined && fees !== 0) params.append("fees", String(fees)); // FIX
    if (specialty) params.append("specialty", specialty);
    if (date) params.append("date", date);
    if (status && status !== "all") params.append("status", status);

    const res = await fetch(
      `/api/patients/${patientId}/appointments?${params.toString()}`
    );

    const data = await res.json();

    if (res.ok && Array.isArray(data)) {
      setAppointments(data);
    } else {
      console.error("Failed to fetch appointments", data?.error || data);
      setAppointments([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    try {
      if (patientId) fetchAppointments();
    } catch (error) {
      console.error("Failed to fetch appointments", error);
    }
  }, [patientId]);

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Your Appointments</h1>
        <p className="text-muted-foreground">View and manage your appointments</p>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Filter Appointments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Input
              value={doctorName}
              onChange={(e) => setDoctorName(e.target.value)}
              placeholder="Doctor Name"
            />
            <Input
              type="number"
              value={fees ?? ""}
              onChange={(e) => setFees(Number(e.target.value))}
              placeholder="Fees"
            />
            <Input
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
              placeholder="Specialty"
            />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={fetchAppointments} className="w-full">
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* List */}
      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!loading && (
        <div className="space-y-4">
          {appointments.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No appointments found</p>
            </div>
          ) : (
            appointments.map((appointment) => (
              <AppointmentCard
                key={appointment.id}
                appointment={appointment}
                onCancel={fetchAppointments}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
