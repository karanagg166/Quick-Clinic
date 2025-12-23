"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import AppointmentCard from "@/components/doctor/appointmentCard";
import type { DoctorAppointment } from "@/types/doctor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export default function DoctorAppointmentsPage() {
  const doctorId = useUserStore((s) => s.doctorId);

  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [loading, setLoading] = useState(false);

  // Existing Filters
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [gender, setGender] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");

  const [status, setStatus] = useState("");

  // NEW filters
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  const [paymentMethod, setPaymentMethod] = useState("");

  const fetchAppointments = async () => {
    if (!doctorId) return;

    setLoading(true);

    const params = new URLSearchParams();
    params.append("doctorId", doctorId);

    if (patientName) params.append("patientName", patientName);
    if (patientEmail) params.append("patientEmail", patientEmail);
    if (gender && gender !== "all") params.append("gender", gender);
    if (city) params.append("city", city);
    if (age) params.append("age", age);

    // NEW FILTERS
    if (startDate) params.append("startDate", startDate);
    if (startTime) params.append("startTime", startTime);
    if (endDate) params.append("endDate", endDate);
    if (endTime) params.append("endTime", endTime);

    if (paymentMethod && paymentMethod !== "all") params.append("paymentMethod", paymentMethod);

    if (status && status !== "all") params.append("status", status);

    const res = await fetch(
      `/api/doctors/${doctorId}/appointments?${params.toString()}`
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
    fetchAppointments();
  }, [doctorId]);

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Your Appointments</h1>
        <p className="text-muted-foreground">Manage and filter your appointments</p>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Filter Appointments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            <Input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Patient Name"
            />
            <Input
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              placeholder="Patient Email"
            />
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger>
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Genders</SelectItem>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="BINARY">Other</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
            />
            <Input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Age"
            />
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start Date"
            />
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="Start Time"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End Date"
            />
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="End Time"
            />
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Payment Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payment Methods</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
              </SelectContent>
            </Select>
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

      {/* Appointments */}
      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!loading && (
        <div className="flex flex-col gap-4">
          {appointments.map((a) => (
            <AppointmentCard appointment={a} key={a.id} />
          ))}
        </div>
      )}
    </div>
  );
}
