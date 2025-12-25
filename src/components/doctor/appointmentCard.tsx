"use client";

import { useState } from "react";
import type { DoctorAppointment } from "@/types/doctor";
import Link from "next/link";
import StatusBadge from "@/components/general/StatusBadge";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/store/userStore";
import { showToast } from "@/lib/toast";

export default function AppointmentCard({ appointment, onStatusUpdate }: { 
  appointment: DoctorAppointment;
  onStatusUpdate?: () => void;
}) {
  const doctorId = useUserStore((s) => s.doctorId);
  const [updating, setUpdating] = useState(false);

  const dateText = (() => {
    const d = new Date(appointment.appointmentDate);
    return isNaN(d.getTime()) ? appointment.appointmentDate : d.toLocaleDateString();
  })();

  const timeText = (() => {
    const t = appointment.appointmentTime;
    const asDate = new Date(t);
    return isNaN(asDate.getTime()) ? t : asDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  })();

  const isPending = appointment.status.toUpperCase() === 'PENDING';

  const handleStatusUpdate = async (newStatus: 'CONFIRMED' | 'CANCELLED') => {
    if (!doctorId || updating) return;

    try {
      setUpdating(true);
      const response = await fetch(
        `/api/doctors/${doctorId}/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: newStatus }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update appointment');
      }

      showToast.success(
        newStatus === 'CONFIRMED' 
          ? 'Appointment confirmed successfully' 
          : 'Appointment cancelled successfully'
      );

      // Call callback to refresh appointments list
      if (onStatusUpdate) {
        onStatusUpdate();
      } else {
        // Reload page if no callback provided
        window.location.reload();
      }
    } catch (error: any) {
      showToast.error(error.message || 'Failed to update appointment');
    } finally {
      setUpdating(false);
    }
  };

  return (
    <div className={`p-5 rounded-xl shadow border transition ${
      isPending 
        ? 'bg-yellow-50 border-yellow-200 ring-2 ring-yellow-100' 
        : 'bg-white hover:shadow-lg'
    }`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm text-gray-500">Appointment</p>
          <h2 className="text-lg font-semibold text-gray-900">
            {appointment.patientName}
          </h2>
          <p className="text-sm text-gray-500">{appointment.gender}</p>
        </div>
        <StatusBadge 
          status={appointment.status.toLowerCase()} 
          showIcon={true}
        />
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-700 mb-4">
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

      {/* Action buttons for pending appointments */}
      {isPending && (
        <div className="flex gap-2 pt-3 border-t border-yellow-200">
          <Button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleStatusUpdate('CONFIRMED');
            }}
            disabled={updating}
            className="flex-1 bg-green-600 hover:bg-green-700"
          >
            {updating ? 'Updating...' : 'Confirm'}
          </Button>
          <Button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleStatusUpdate('CANCELLED');
            }}
            disabled={updating}
            variant="destructive"
            className="flex-1"
          >
            {updating ? 'Updating...' : 'Reject'}
          </Button>
          <Link href={`/doctor/appointments/${appointment.id}`} className="flex-1">
            <Button variant="outline" className="w-full">
              View Details
            </Button>
          </Link>
        </div>
      )}

      {/* View details link for non-pending appointments */}
      {!isPending && (
        <Link href={`/doctor/appointments/${appointment.id}`} className="block mt-3 pt-3 border-t">
          <Button variant="outline" className="w-full">
            View Details
          </Button>
        </Link>
      )}
    </div>
  );
}
