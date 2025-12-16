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
import Avatar from "@/components/general/Avatar";

export default function DoctorCard({ doctor }: { doctor: Doctor }) {
  return (
    <div className="border p-4 rounded shadow mb-4 hover:shadow-lg transition">
      {/* Profile Image and Name */}
      <div className="flex items-start gap-4 mb-4">
        <Avatar 
          src={doctor.profileImageUrl} 
          name={doctor.name}
          size="lg"
        />
        <div className="flex-1">
          <h2 className="text-xl font-bold mb-1">{doctor.name}</h2>
          <p className="text-sm text-gray-600 font-medium">{doctor.specialty}</p>
        </div>
      </div>

      {/* AGE */}
      <p className="mb-1 text-sm">
        <User className="inline mr-2 w-4 h-4" />
        Age: {doctor.age}
      </p>

      {/* GENDER */}
      <p className="mb-1 text-sm">
        <User className="inline mr-2 w-4 h-4" />
        Gender: {doctor.gender}
      </p>

      <p className="mb-1 text-sm">
        <Calendar className="inline mr-2 w-4 h-4" />
        Experience: {doctor.experience} years
      </p>

      <p className="mb-1 text-sm">
        <Search className="inline mr-2 w-4 h-4" />
        Fees: ${doctor.fees}
      </p>

      <p className="mb-1 text-sm">
        <MapPin className="inline mr-2 w-4 h-4" />
        Location: {doctor.city}, {doctor.state}
      </p>

      <p className="mb-3 text-sm">
        <Star className="inline mr-2 w-4 h-4" />
        Qualifications: {doctor.qualifications?.join(", ") ?? "No qualifications listed"}
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
