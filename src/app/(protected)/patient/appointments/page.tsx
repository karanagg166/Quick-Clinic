"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import AppointmentCard from "@/components/patient/appointmentCard";
import type { PatientAppointment } from "@/types/patient";

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
    if (status) params.append("status", status);

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
    if (patientId) fetchAppointments();
  }, [patientId]);

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-4">Your Appointments</h1>

      {/* Filters */}
      <div className="bg-white p-4 rounded shadow mb-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <input
          value={doctorName}
          onChange={(e) => setDoctorName(e.target.value)}
          placeholder="Doctor Name"
          className="border p-2 rounded"
        />

        <input
          type="number"
          value={fees ?? ""}
          onChange={(e) => setFees(Number(e.target.value))}
          placeholder="Fees"
          className="border p-2 rounded"
        />

        <input
          value={specialty}
          onChange={(e) => setSpecialty(e.target.value)}
          placeholder="Specialty"
          className="border p-2 rounded"
        />

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="border p-2 rounded"
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="">All Status</option>
          <option value="PENDING">Pending</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="COMPLETED">Completed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>

        <button
          onClick={fetchAppointments}
          className="bg-blue-600 text-white p-2 rounded"
        >
          Search
        </button>
      </div>

      {/* List */}
      {loading && <p>Loading...</p>}

      <div>
        {appointments.map((appointment) => (
          <AppointmentCard key={appointment.id} appointment={appointment} />
        ))}
      </div>
    </div>
  );
}
