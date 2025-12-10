"use client";

import type { PatientAppointment } from "@/types/patient";

export default function AppointmentCard({ appointment }: { appointment: PatientAppointment }) {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md border hover:shadow-lg transition space-y-1">

      <h1 className="text-xl font-semibold">Appointment Details</h1>
{/* 
      <p><strong>ID:</strong> {appointment.id}</p> */}

      <p><strong>Date:</strong> {appointment.appointmentDate}</p>

      <p><strong>Time:</strong> {appointment.appointmentTime}</p>

      <p><strong>Doctor Name:</strong> {appointment.doctorName}</p>

      <p><strong>Doctor Email:</strong> {appointment.doctorEmail}</p>

      <p><strong>City:</strong> {appointment.city}</p>

      <p><strong>Fees:</strong> ₹{appointment.fees}</p>

      <p><strong>Status:</strong> {appointment.status}</p>

      <p><strong>Specialty:</strong> {appointment.specialty}</p>

    </div>
  );
}
