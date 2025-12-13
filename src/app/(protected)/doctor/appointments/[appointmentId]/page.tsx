'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import type { AppointmentDetail } from '@/types/common';

export default function DoctorAppointmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const doctorId = useUserStore((s) => s.doctorId);
  const { user } = useUserStore();
  const appointmentId = typeof params.appointmentId === 'string'
    ? params.appointmentId
    : Array.isArray(params.appointmentId)
    ? params.appointmentId[0]
    : '';

  const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [statusValue, setStatusValue] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('');
  const [isOffline, setIsOffline] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const statusOptions = ['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED'];
  const paymentOptions = ['OFFLINE', 'ONLINE'];

  useEffect(() => {
    const fetchAppointment = async () => {
      if (!doctorId) {
        setError('Doctor not identified');
        setLoading(false);
        return;
      }
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/doctors/${doctorId}/appointments/${appointmentId}`);
        if (!res.ok) throw new Error('Failed to fetch appointment');
        const data: AppointmentDetail = await res.json();
        setAppointment(data);
        setStatusValue(String(data.status));
        setPaymentMethod(String(data.paymentMethod));
        setIsOffline(Boolean(data.isAppointmentOffline));
      } catch (e: any) {
        setError(e?.message || 'Something went wrong');
      } finally {
        setLoading(false);
      }
    };
    fetchAppointment();
  }, [appointmentId, doctorId]);

  const applyChanges = async () => {
    if (!doctorId || !appointmentId) return;
    try {
      setSaving(true);
      const params = new URLSearchParams();
      if (statusValue) params.append('status', statusValue);
      if (paymentMethod) params.append('paymentMethod', paymentMethod);
      params.append('isAppointmentOffline', String(isOffline));

      const res = await fetch(`/api/doctors/${doctorId}/appointments/${appointmentId}?${params.toString()}`, {
        method: 'PATCH',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || 'Failed to update appointment');
      }

      const fresh = await fetch(`/api/doctors/${doctorId}/appointments/${appointmentId}`);
      if (fresh.ok) {
        const data: AppointmentDetail = await fresh.json();
        setAppointment(data);
        setStatusValue(String(data.status));
        setPaymentMethod(String(data.paymentMethod));
        setIsOffline(Boolean(data.isAppointmentOffline));
      }
    } catch (err: any) {
      alert(err?.message || 'Could not update appointment.');
    } finally {
      setSaving(false);
    }
  };

  const startConversation = async () => {
    try {
      if (!user?.userId) {
        alert('Please log in as a doctor to start a chat.');
        return;
      }
      const patientUserId = appointment?.patient?.user?.id;
      if (!patientUserId) {
        alert('Patient details are incomplete. Please try again.');
        return;
      }
      setStartingChat(true);
      const res = await fetch('/api/doctorpatientrelations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorsUserId: user.userId,
          patientsUserId: patientUserId,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData?.error || 'Failed to start conversation');
      }
      const data = await res.json();
      const relationId = data?.relation?.id;
      if (!relationId) throw new Error('Missing relation id from server');
      router.push(`/doctor/chat/${relationId}`);
    } catch (err: any) {
      alert(err?.message || 'Could not start conversation. Please try again.');
    } finally {
      setStartingChat(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-gray-600">Loading appointment...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="p-6">
        <p className="text-gray-600">No appointment details available.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Appointment Details</h1>

      <div className="bg-white rounded-lg shadow-md border p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Appointment Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <p><span className="font-semibold">ID:</span> {appointment.id}</p>
          <p><span className="font-semibold">Status:</span> <span className={`px-2 py-1 rounded text-white ${appointment.status === 'CONFIRMED' ? 'bg-green-500' : appointment.status === 'PENDING' ? 'bg-yellow-500' : appointment.status === 'CANCELLED' ? 'bg-red-500' : 'bg-blue-500'}`}>{appointment.status}</span></p>
          <p><span className="font-semibold">Booked At:</span> {new Date(appointment.bookedAt).toLocaleString()}</p>
          <p><span className="font-semibold">Payment Method:</span> {appointment.paymentMethod}</p>
          <p><span className="font-semibold">Appointment Mode:</span> {appointment.isAppointmentOffline ? 'Offline' : 'Online'}</p>
          {appointment.transactionId && <p><span className="font-semibold">Transaction ID:</span> {appointment.transactionId}</p>}
          {appointment.notes && <p><span className="font-semibold">Notes:</span> {appointment.notes}</p>}
        </div>
        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
          <label className="flex flex-col text-sm text-gray-700 gap-2">
            Status
            <div className="flex flex-wrap gap-2">
              {statusOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setStatusValue(option)}
                  className={`px-3 py-1 rounded-full text-sm border transition ${statusValue === option ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-800 border-gray-300 hover:border-blue-400'}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </label>

          <label className="flex flex-col text-sm text-gray-700 gap-2">
            Payment Method
            <div className="flex flex-wrap gap-2">
              {paymentOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setPaymentMethod(option)}
                  className={`px-3 py-1 rounded-full text-sm border transition ${paymentMethod === option ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-gray-800 border-gray-300 hover:border-emerald-400'}`}
                >
                  {option}
                </button>
              ))}
            </div>
          </label>

          <div className="flex flex-col text-sm text-gray-700 gap-2 mt-6 md:mt-0">
            <span className="text-xs uppercase tracking-wide text-gray-600">Mode</span>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'Offline', value: true },
                { label: 'Online', value: false },
              ].map((opt) => (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setIsOffline(opt.value)}
                  className={`px-3 py-1 rounded-full text-sm border transition ${isOffline === opt.value ? 'bg-purple-600 text-white border-purple-600' : 'bg-white text-gray-800 border-gray-300 hover:border-purple-400'}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex gap-3 flex-wrap">
          <button
            type="button"
            onClick={startConversation}
            disabled={startingChat}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md shadow hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {startingChat ? 'Starting...' : '💬 Start conversation with patient'}
          </button>
          <button
            type="button"
            onClick={applyChanges}
            disabled={saving}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md shadow hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
          >
            {saving ? 'Saving...' : 'Save changes'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md border p-6 mb-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Appointment Slot</h2>
        <div className="grid grid-cols-2 gap-4">
          <p><span className="font-semibold">Date:</span> {new Date(appointment.slot.date).toLocaleDateString()}</p>
          <p><span className="font-semibold">Start Time:</span> {new Date(appointment.slot.startTime).toLocaleTimeString()}</p>
          <p><span className="font-semibold">End Time:</span> {new Date(appointment.slot.endTime).toLocaleTimeString()}</p>
          <p><span className="font-semibold">Slot Status:</span> {appointment.slot.status}</p>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow-md border p-6">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Patient Information</h2>
        <div className="grid grid-cols-2 gap-4">
          <p><span className="font-semibold">Name:</span> {appointment.patient.user.name}</p>
          <p><span className="font-semibold">Email:</span> {appointment.patient.user.email}</p>
          <p><span className="font-semibold">Phone:</span> {appointment.patient.user.phoneNo}</p>
          <p><span className="font-semibold">Age:</span> {appointment.patient.user.age}</p>
          <p><span className="font-semibold">Gender:</span> {appointment.patient.user.gender}</p>
          <p><span className="font-semibold">Address:</span> {appointment.patient.user.address}</p>
          <p><span className="font-semibold">City:</span> {appointment.patient.user.city}, {appointment.patient.user.state}</p>
          {appointment.patient.medicalHistory && <p><span className="font-semibold">Medical History:</span> {appointment.patient.medicalHistory}</p>}
          {appointment.patient.allergies && <p><span className="font-semibold">Allergies:</span> {appointment.patient.allergies}</p>}
          {appointment.patient.currentMedications && <p><span className="font-semibold">Current Medications:</span> {appointment.patient.currentMedications}</p>}
        </div>
      </div>
    </div>
  );
}
