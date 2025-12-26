'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import type { AppointmentDetail } from '@/types/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { showToast } from '@/lib/toast';

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
      showToast.error(err?.message || 'Could not update appointment.');
    } finally {
      setSaving(false);
    }
  };

  const startConversation = async () => {
    try {
      if (!user?.id) {
        showToast.warning('Please log in as a doctor to start a chat.');
        return;
      }
      const patientUserId = appointment?.patient?.user?.id;
      if (!patientUserId) {
        showToast.warning('Patient details are incomplete. Please try again.');
        return;
      }
      setStartingChat(true);
      const res = await fetch('/api/doctorpatientrelations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          doctorsUserId: user.id,
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
      showToast.error(err?.message || 'Could not start conversation. Please try again.');
    } finally {
      setStartingChat(false);
    }
  };

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="max-w-4xl mx-auto m-6">
        <CardContent className="pt-6">
          <p className="text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (!appointment) {
    return (
      <Card className="max-w-4xl mx-auto m-6">
        <CardContent className="pt-6">
          <p className="text-muted-foreground">No appointment details available.</p>
        </CardContent>
      </Card>
    );
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return 'default';
      case 'PENDING':
        return 'outline';
      case 'CANCELLED':
        return 'destructive';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold mb-6">Appointment Details</h1>

      <Card>
        <CardHeader>
          <CardTitle>Appointment Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <p><span className="font-semibold">ID:</span> {appointment.id}</p>
            <p className="flex items-center gap-2">
              <span className="font-semibold">Status:</span>
              <Badge variant={getStatusBadgeVariant(appointment.status)}>
                {appointment.status}
              </Badge>
            </p>
            <p><span className="font-semibold">Booked At:</span> {new Date(appointment.bookedAt).toLocaleString()}</p>
            <p><span className="font-semibold">Payment Method:</span> {appointment.paymentMethod}</p>
            <p><span className="font-semibold">Appointment Mode:</span> {appointment.isAppointmentOffline ? 'Offline' : 'Online'}</p>
            {appointment.transactionId && <p><span className="font-semibold">Transaction ID:</span> {appointment.transactionId}</p>}
            {appointment.notes && <p><span className="font-semibold">Notes:</span> {appointment.notes}</p>}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Status</label>
              <div className="flex flex-wrap gap-2">
                {statusOptions.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    onClick={() => setStatusValue(option)}
                    variant={statusValue === option ? "default" : "outline"}
                    size="sm"
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Payment Method</label>
              <div className="flex flex-wrap gap-2">
                {paymentOptions.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    onClick={() => setPaymentMethod(option)}
                    variant={paymentMethod === option ? "default" : "outline"}
                    size="sm"
                    className={paymentMethod === option ? "bg-emerald-600 hover:bg-emerald-700" : ""}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Mode</label>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: 'Offline', value: true },
                  { label: 'Online', value: false },
                ].map((opt) => (
                  <Button
                    key={opt.label}
                    type="button"
                    onClick={() => setIsOffline(opt.value)}
                    variant={isOffline === opt.value ? "default" : "outline"}
                    size="sm"
                    className={isOffline === opt.value ? "bg-purple-600 hover:bg-purple-700" : ""}
                  >
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex gap-3 flex-wrap pt-4 border-t">
            <Button
              type="button"
              onClick={startConversation}
              disabled={startingChat}
            >
              {startingChat ? 'Starting...' : '💬 Start conversation with patient'}
            </Button>
            <Button
              type="button"
              onClick={applyChanges}
              disabled={saving}
              className="bg-green-600 hover:bg-green-700"
            >
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Appointment Slot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4">
            <p><span className="font-semibold">Date:</span> {new Date(appointment.slot.date).toLocaleDateString()}</p>
            <p><span className="font-semibold">Start Time:</span> {new Date(appointment.slot.startTime).toLocaleTimeString()}</p>
            <p><span className="font-semibold">End Time:</span> {new Date(appointment.slot.endTime).toLocaleTimeString()}</p>
            <p><span className="font-semibold">Slot Status:</span> {appointment.slot.status}</p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Patient Information</CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
