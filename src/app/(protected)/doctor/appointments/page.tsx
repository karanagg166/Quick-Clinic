"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import AppointmentCard from "@/components/general/appointmentCard";

type DoctorAppointment = {
  id: string;
  slotId?: string;
  slotStart?: string;
  slotEnd?: string;
  status: string;
  notes?: string | null;
  patientId?: string;
  patientName?: string;
  patientContact?: string;
};

export default function DoctorAppointmentsPage() {
  const doctorId = useUserStore((s) => s.doctorId);

  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [loading, setLoading] = useState(false);

  // Filters
  const [patientName, setPatientName] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");

  const fetchAppointments = async () => {
    if (!doctorId) return;

    setLoading(true);

    const params = new URLSearchParams();
    params.append("doctorId", doctorId);

    if (patientName) params.append("patientName", patientName);
    if (date) params.append("date", date);
    if (status) params.append("status", status);

    const res = await fetch(`/api/doctors/appointments?${params.toString()}`);
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

  // Delete (Cancel) Appointment
  const handleDelete = async (id: string) => {
    await fetch(`/api/doctors/appointments`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ appointmentId: id }),
    });
    fetchAppointments();
  };

  return (
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-4">Your Appointments</h1>

      {/* Filters */}
      <div className="bg-white p-4 rounded shadow mb-6 grid gap-4 md:grid-cols-3">
        <input
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          placeholder="Patient Name"
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

      {/* Appointments */}
      {loading && <p>Loading...</p>}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {appointments.map((a) => (
          <AppointmentCard
            appointment={a}
            key={a.id}
            role="doctor"
            onDelete={handleDelete}
          />
        ))}
      </div>
    </div>
  );
}
