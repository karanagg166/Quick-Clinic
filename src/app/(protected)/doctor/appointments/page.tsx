"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import AppointmentCard from "@/components/doctor/appointmentCard";
import type { DoctorAppointment } from "@/types/doctor";

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
    if (gender) params.append("gender", gender);
    if (city) params.append("city", city);
    if (age) params.append("age", age);

    // NEW FILTERS
    if (startDate) params.append("startDate", startDate);
    if (startTime) params.append("startTime", startTime);
    if (endDate) params.append("endDate", endDate);
    if (endTime) params.append("endTime", endTime);

    if (paymentMethod) params.append("paymentMethod", paymentMethod);

    if (status) params.append("status", status);

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
    <div className="p-6 bg-gray-50 min-h-screen">
      <h1 className="text-3xl font-bold mb-4">Your Appointments</h1>

      {/* Filters */}
      <div className="bg-white p-4 rounded shadow mb-6 grid gap-4 md:grid-cols-3 lg:grid-cols-4">

        <input
          value={patientName}
          onChange={(e) => setPatientName(e.target.value)}
          placeholder="Patient Name"
          className="border p-2 rounded"
        />

        <input
          value={patientEmail}
          onChange={(e) => setPatientEmail(e.target.value)}
          placeholder="Patient Email"
          className="border p-2 rounded"
        />

        <select
          value={gender}
          onChange={(e) => setGender(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="">Gender</option>
          <option value="MALE">Male</option>
          <option value="FEMALE">Female</option>
          <option value="BINARY">Other</option>
        </select>

        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="City"
          className="border p-2 rounded"
        />

        <input
          type="number"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          placeholder="Age"
          className="border p-2 rounded"
        />

        {/* NEW DATE/TIME FILTERS */}

        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          placeholder="Start Date"
          className="border p-2 rounded"
        />

        <input
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          placeholder="Start Time"
          className="border p-2 rounded"
        />

        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          placeholder="End Date"
          className="border p-2 rounded"
        />

        <input
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          placeholder="End Time"
          className="border p-2 rounded"
        />

        {/* Payment Method */}
        <select
          value={paymentMethod}
          onChange={(e) => setPaymentMethod(e.target.value)}
          className="border p-2 rounded"
        >
          <option value="">Payment Method</option>
          <option value="CASH">Cash</option>
          <option value="CARD">Card</option>
          <option value="UPI">UPI</option>
        </select>

        {/* Status */}
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
          <AppointmentCard appointment={a} key={a.id} />
        ))}
      </div>
    </div>
  );
}
