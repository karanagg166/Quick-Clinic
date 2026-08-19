"use client";

import { useState } from "react";
import type { PatientAppointment } from "@/types/patient";
import Link from "next/link";
import StatusBadge from "@/components/general/StatusBadge";
import { Button } from "@/components/ui/button";
import { useUserStore } from "@/store/userStore";
import { showToast } from "@/lib/toast";

export default function AppointmentCard({ 
  appointment,
  onCancel 
}: { 
  appointment: PatientAppointment;
  onCancel?: () => void;
}) {
  const patientId = useUserStore((s) => s.patientId);
  const [cancelling, setCancelling] = useState(false);

  const dateText = (() => {
    const d = new Date(appointment.appointmentDate);
    return isNaN(d.getTime()) ? appointment.appointmentDate : d.toLocaleDateString("en-US", { timeZone: "UTC" });
  })();

  const timeText = (() => {
    const t = appointment.appointmentTime;
    const asDate = new Date(t);
    return isNaN(asDate.getTime()) ? t : asDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
  })();

  const canCancel = appointment.status === 'PENDING' || appointment.status === 'CONFIRMED';

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!patientId || cancelling) return;

    if (!confirm('Are you sure you want to cancel this appointment? If you paid online, a refund will be processed.')) {
      return;
    }

    try {
      setCancelling(true);
      const response = await fetch(
        `/api/patients/${patientId}/appointments/${appointment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to cancel appointment');
      }

      const data = await response.json();
      
      showToast.success(
        data.refundProcessed 
          ? 'Appointment cancelled successfully. Refund will be processed to your original payment method.'
          : 'Appointment cancelled successfully'
      );

      // Call callback to refresh appointments list
      if (onCancel) {
        onCancel();
      } else {
        window.location.reload();
      }
    } catch (error: any) {
      showToast.error(error.message || 'Failed to cancel appointment');
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="p-5 bg-white rounded-xl shadow border hover:shadow-lg transition">
      <Link href={`/patient/appointments/${appointment.id}`} className="block">
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-sm text-gray-500">Appointment</p>
            <h2 className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition">
              Dr. {appointment.doctorName}
            </h2>
            <p className="text-sm text-gray-500">{appointment.specialty}</p>
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
            <p className="text-xs text-gray-500">Fees</p>
            <p className="font-medium">₹{appointment.fees}</p>
          </div>
        </div>
      </Link>

      {/* Action buttons */}
      <div className="pt-3 border-t flex flex-col sm:flex-row gap-2">
        <Link href={`/patient/appointments/${appointment.id}`} className="flex-1">
          <Button variant="outline" className="w-full text-xs sm:text-sm">
            View Details
          </Button>
        </Link>
        {canCancel && (
          <Button
            onClick={handleCancel}
            disabled={cancelling}
            variant="destructive"
            className="flex-1 text-xs sm:text-sm"
          >
            {cancelling ? 'Cancelling...' : 'Cancel Appointment'}
          </Button>
        )}
      </div>
    </div>
  );
}
