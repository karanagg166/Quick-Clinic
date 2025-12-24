'use client';
import React, { useState, useEffect } from 'react';
import { DoctorAppointment } from '@/types/doctor';
import AppointmentCard from '@/components/doctor/appointmentCard';
import EmptyState from '@/components/general/EmptyState';
import { CalendarDays } from 'lucide-react';
import LoadingSpinner from '@/components/general/LoadingSpinner';

export default function TodaysAppointmentSection({ doctorId }: { doctorId: string }) {
  const [appointments, setAppointments] = useState<Array<DoctorAppointment>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAppointments = async () => {
      if (!doctorId) return;

      try {
        setLoading(true);
        setError(null);

        // Build "today" range for the API filters it supports (startDate/startTime/endDate/endTime)
        const now = new Date();
        const yyyyMmDd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
        const startTime = '00:00:00';
        const endTime = '23:59:59';

        const response = await fetch(
          `/api/doctors/${doctorId}/appointments?startDate=${yyyyMmDd}&startTime=${startTime}&endDate=${yyyyMmDd}&endTime=${endTime}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch appointments');
        }

        const data = await response.json();
        // API returns an array directly, not wrapped in { appointments }
        setAppointments(Array.isArray(data) ? data : []);
      } catch (error) {
        setError(error instanceof Error ? error.message : 'Failed to fetch appointments');
        console.error('Error fetching appointments:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [doctorId]);

  return (
    <div className="space-y-4">
      {/* Header */}
      <h2 className="text-2xl font-bold text-gray-900">Today's Appointments</h2>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && appointments.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="No appointments today"
          description="You don't have any appointments scheduled for today. Check your schedule or upcoming appointments."
        />
      )}

      {/* Appointments List */}
      {!loading && !error && appointments.length > 0 && (
        <div className="space-y-3">
          {appointments.map((appointment) => (
            <AppointmentCard key={appointment.id} appointment={appointment} />
          ))}
        </div>
      )}
    </div>
  );
}