"use client";

import type { PatientAppointment } from "@/types/patient";
import Link from "next/link";
import StatusBadge from "@/components/general/StatusBadge";

export default function AppointmentCard({ appointment }: { appointment: PatientAppointment }) {
  const date = new Date(appointment.appointmentDate);
  const timeText = (() => {
    const t = appointment.appointmentTime;
    const asDate = new Date(t);
    return isNaN(asDate.getTime()) ? t : asDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  })();
  return (
    <Link href={`/patient/appointments/${appointment.id}`} className="block">
      <div className="p-5 bg-white rounded-xl shadow border hover:shadow-lg transition group">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm text-gray-500">Appointment</p>
            <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition">
              Dr. {appointment.doctorName}
            </h2>
            <p className="text-sm text-gray-500">{appointment.specialty}</p>
          </div>
          <StatusBadge 
            status={appointment.status.toLowerCase()} 
            showIcon={true}
          />
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
          <div>
            <p className="text-xs text-gray-500">Date</p>
            <p className="font-medium">{date.toLocaleDateString()}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Time</p>
            <p className="font-medium">{timeText}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">City</p>
            <p className="font-medium">{appointment.city}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Fees</p>
            <p className="font-medium">₹{appointment.fees}</p>
          </div>
        </div>
      </div>
    </Link>
  );
}
