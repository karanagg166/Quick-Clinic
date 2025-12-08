
'use client'
import { useEffect, useState } from "react";
import BookTimeSlot from "@/components/patient/bookTimeSlot";
import { useParams } from "next/navigation";

interface DoctorDetails {
  id: string;
  userId: string;
  specialty: string;
  experience: number;
  qualifications: string[];
  bio: string;
  fees: number;
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    city: string;
    state: string;
  };
}

export default function DoctorDetails() {
  const params = useParams();
  const doctorId = params.doctorId as string;
  const [doctor, setDoctor] = useState<DoctorDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDoctor = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/doctors/${doctorId}`);
        if (!res.ok) {
          throw new Error("Failed to fetch doctor details");
        }
        const data = await res.json();
        setDoctor(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "An error occurred");
      } finally {
        setLoading(false);
      }
    };

    if (doctorId) {
      fetchDoctor();
    }
  }, [doctorId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-center text-gray-600">Loading doctor details...</p>
      </div>
    );
  }

  if (error || !doctor) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <p className="text-center text-red-600">{error || "Doctor not found"}</p>
      </div>
    );
  }

  return (
    <>
      <div className="max-w-3xl mx-auto p-6 shadow rounded">
        <h2 className="text-2xl font-bold mb-4">Doctor Details</h2>
        {/* Doctor information section */}
        <div className="mb-6">
          <h3 className="text-xl font-semibold">Dr. {doctor.user.firstName} {doctor.user.lastName}</h3>
          <p className="text-gray-600">Specialization: {doctor.specialty}</p>
          <p className="text-gray-600">Experience: {doctor.experience} years</p>
          <p className="text-gray-600">Fees: ₹{doctor.fees}</p>
          <p className="text-gray-600">Location: {doctor.user.city}, {doctor.user.state}</p>
          <p className="text-gray-600">Contact:
            <a href={`mailto:${doctor.user.email}`}>{doctor.user.email}</a>
          </p>
          {doctor.bio && (
            <p className="text-gray-700 mt-4">{doctor.bio}</p>
          )}
        </div>
        {/* Book appointment section */}
        <BookTimeSlot doctorId={doctorId}/>
            </div>
        </>
    );
}