"use client";

import type { Patient } from "@/types/patient";
import Avatar from "@/components/general/Avatar";

export default function PatientCard({ patient }: { patient: Patient }) {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md border hover:shadow-lg transition space-y-3">
      {/* Profile Image and Name */}
      <div className="flex items-start gap-4">
        <Avatar 
          src={patient.profileImageUrl} 
          name={patient.name}
          size="lg"
        />
        <div className="flex-1">
          <h2 className="text-xl font-bold">{patient.name}</h2>
          <p className="text-sm text-gray-600">{patient.email}</p>
        </div>
      </div>

      <hr className="my-2" />

      <div className="space-y-1 text-sm">
        <p><strong>Age:</strong> {patient.age}</p>
        <p><strong>Gender:</strong> {patient.gender}</p>

        {patient.city && <p><strong>City:</strong> {patient.city}</p>}
        {patient.state && <p><strong>State:</strong> {patient.state}</p>}

        <p><strong>Medical History:</strong> {patient.medicalHistory || "None"}</p>
        <p><strong>Allergies:</strong> {patient.allergies || "None"}</p>
        <p><strong>Medications:</strong> {patient.currentMedications || "None"}</p>
      </div>
    </div>
  );
}
