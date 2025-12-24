'use client';
import React, { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import type { PatientAppointment } from '@/types/patient';
import AppointmentCard from '@/components/patient/appointmentCard';
import EmptyState from '@/components/general/EmptyState';
import { CalendarDays } from 'lucide-react';
import LoadingSpinner from '@/components/general/LoadingSpinner';

export default function UpcomingAppointmentsSection() {
  const { patientId } = useUserStore();
  const [appointments, setAppointments] = useState<Array<PatientAppointment>>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAppointments = async () => {
      if (!patientId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const res = await fetch(`/api/patients/${patientId}/appointments`);
        if (!res.ok) throw new Error('Failed to fetch appointments');
        const data: PatientAppointment[] = await res.json();

        const now = new Date();
        const upcoming = data.filter((a) => {
          // appointmentDate is ISO string
          try {
            const d = new Date(a.appointmentDate);
            return d.getTime() > now.getTime();
          } catch {
            return false;
          }
        });

        // Sort ascending by date/time
        upcoming.sort((a, b) => new Date(a.appointmentDate).getTime() - new Date(b.appointmentDate).getTime());

        setAppointments(upcoming);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to fetch appointments');
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [patientId]);

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-bold text-gray-900">Upcoming Appointments</h2>

      {loading && (
        <div className="flex items-center justify-center py-12">
          <LoadingSpinner />
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <p>{error}</p>
        </div>
      )}

      {!loading && !error && appointments.length === 0 && (
        <EmptyState
          icon={CalendarDays}
          title="No upcoming appointments"
          description="You currently have no appointments scheduled. Browse doctors to book your next appointment."
        />
      )}

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
