"use client";

import {
  Search,
  MapPin,
  Stethoscope,
  Star,
  Calendar,
  User,
} from "lucide-react";
import Link from "next/link";
import type { Doctor } from "@/types/doctor";

export default function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <div className="border p-4 rounded shadow mb-4">
      <h2 className="text-xl font-bold mb-2">{doctor.name}</h2>

      {/* AGE */}
      <p className="mb-1">
        <User className="inline mr-2" />
        Age: {doctor.age}
      </p>

      {/* GENDER */}
      <p className="mb-1">
        <User className="inline mr-2" />
        Gender: {doctor.gender}
      </p>

      <p className="mb-1">
        <Stethoscope className="inline mr-2" />
        Specialty: {doctor.specialty}
      </p>

      <p className="mb-1">
        <Calendar className="inline mr-2" />
        Experience: {doctor.experience} years
      </p>

      <p className="mb-1">
        <Search className="inline mr-2" />
        Fees: ${doctor.fees}
      </p>

      <p className="mb-1">
        <MapPin className="inline mr-2" />
        Location: {doctor.city}, {doctor.state}
      </p>

      <p className="mb-1">
        <Star className="inline mr-2" />
        Qualifications: {doctor.qualifications.join(", ")}
      </p>

      <Link
        href={`/patient/doctor/${doctor.id}`}
        className="text-blue-600 hover:underline"
      >
        View Profile
      </Link>
    </div>
  );
}
