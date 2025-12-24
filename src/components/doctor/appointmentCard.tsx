"use client";

import type { DoctorAppointment } from "@/types/doctor";
import Link from "next/link";
import StatusBadge from "@/components/general/StatusBadge";

export default function AppointmentCard({ appointment }: { appointment: DoctorAppointment }) {
  const dateText = (() => {
    const d = new Date(appointment.appointmentDate);
    return isNaN(d.getTime()) ? appointment.appointmentDate : d.toLocaleDateString();
  })();

  const timeText = (() => {
    const t = appointment.appointmentTime;
    const asDate = new Date(t);
    return isNaN(asDate.getTime()) ? t : asDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  })();

  return (
    <Link href={`/doctor/appointments/${appointment.id}`} className="block">
      <div className="p-5 bg-white rounded-xl shadow border hover:shadow-lg transition group">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm text-gray-500">Appointment</p>
            <h2 className="text-lg font-semibold text-gray-900 group-hover:text-blue-600 transition">
              {appointment.patientName}
            </h2>
            <p className="text-sm text-gray-500">{appointment.gender}</p>
          </div>
          <StatusBadge 
            status={appointment.status.toLowerCase()} 
            showIcon={true}
          />
        </div>

        <div className="flex flex-wrap gap-4 text-sm text-gray-700">
          <div>
            <p className="text-xs text-gray-500">Date</p>
            <p className="font-medium">{dateText}</p>
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
            <p className="text-xs text-gray-500">Age</p>
            <p className="font-medium">{Number(appointment.age)}</p>
          </div>
          {appointment.patientString && (
            <div>
              <p className="text-xs text-gray-500">Contact</p>
              <p className="font-medium truncate max-w-[180px]">{appointment.patientString}</p>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
