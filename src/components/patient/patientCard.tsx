"use client";

import type { Patient } from "@/types/patient";
import Link from "next/link";

export default function PatientCard({ patient }: { patient: Patient }) {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md border hover:shadow-lg transition space-y-2">
      <h2 className="text-xl font-bold">{patient.name}</h2>

      <p><strong>Age:</strong> {patient.age}</p>
      <p><strong>Gender:</strong> {patient.gender}</p>
      <p><strong>Email:</strong> {patient.email}</p>

      {patient.city && <p><strong>City:</strong> {patient.city}</p>}
      {patient.state && <p><strong>State:</strong> {patient.state}</p>}

      <p><strong>Medical History:</strong> {patient.medicalHistory || "None"}</p>
      <p><strong>Allergies:</strong> {patient.allergies || "None"}</p>
      <p><strong>Medications:</strong> {patient.currentMedications || "None"}</p>

      <Link
        href={`/doctor/patient/${patient.id}`}
        className="text-blue-600 hover:underline"
      >
        View Profile
      </Link>
    </div>
  );
}
