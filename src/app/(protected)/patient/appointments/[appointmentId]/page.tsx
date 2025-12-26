

'use client';
import { useState, useEffect } from 'react';
import { useUserStore } from '@/store/userStore';
import { useParams, useRouter } from 'next/navigation';
import type { AppointmentDetail } from '@/types/common';
import { showToast } from '@/lib/toast';

export default function AppointmentPage() {
    const params = useParams();
    const appointmentId = typeof params.appointmentId === 'string' ? params.appointmentId : Array.isArray(params.appointmentId) ? params.appointmentId[0] : '';
    const patientId = useUserStore((s) => s.patientId);
    const { user } = useUserStore();
    const router = useRouter();

    const [appointment, setAppointment] = useState<AppointmentDetail | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [startingChat, setStartingChat] = useState<boolean>(false);

    useEffect(() => {
        const fetchAppointment = async () => {
            if (!patientId) {
                setError('Patient not identified');
                setLoading(false);
                return;
            }
            try {
                setLoading(true);
                setError(null);
                const res = await fetch(`/api/patients/${patientId}/appointments/${appointmentId}`);
                if (!res.ok) throw new Error('Failed to fetch appointment');
                const data: AppointmentDetail = await res.json();
                setAppointment(data);
            } catch (e: any) {
                setError(e?.message || 'Something went wrong');
            } finally {
                setLoading(false);
            }
        };
        fetchAppointment();
    }, [appointmentId, patientId]);

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

    const startConversation = async () => {
        try {
            if (!user?.id) {
                showToast.warning('Please log in as a patient to start a chat.');
                return;
            }

            const doctorUserId = appointment.doctor?.user?.id;
            if (!doctorUserId) {
                showToast.warning('Doctor details are incomplete. Please try again.');
                return;
            }

            setStartingChat(true);

            const res = await fetch('/api/doctorpatientrelations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doctorsUserId: doctorUserId,
                    patientsUserId: user.id,
                }),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData?.error || 'Failed to start conversation');
            }

            const data = await res.json();
            const relationId = data?.relation?.id;

            if (!relationId) {
                throw new Error('Missing relation id from server');
            }

            router.push(`/patient/chat/${relationId}`);
        } catch (e: any) {
            showToast.error(e?.message || 'Could not start conversation. Please try again.');
        } finally {
            setStartingChat(false);
        }
    };

    return (
        <div className="p-6 max-w-4xl mx-auto">
            <h1 className="text-2xl font-bold text-gray-900 mb-6">Appointment Details</h1>
            
            {/* Appointment Core Info */}
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
                <div className="mt-4 flex gap-3">
                    <button
                        type="button"
                        onClick={startConversation}
                        disabled={startingChat}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md shadow hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition"
                    >
                        {startingChat ? 'Starting...' : '💬 Start conversation with doctor'}
                    </button>
                </div>
            </div>

            {/* Slot / Time Info */}
            <div className="bg-white rounded-lg shadow-md border p-6 mb-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Appointment Slot</h2>
                <div className="grid grid-cols-2 gap-4">
                    <p><span className="font-semibold">Date:</span> {new Date(appointment.slot.date).toLocaleDateString()}</p>
                    <p><span className="font-semibold">Start Time:</span> {new Date(appointment.slot.startTime).toLocaleTimeString()}</p>
                    <p><span className="font-semibold">End Time:</span> {new Date(appointment.slot.endTime).toLocaleTimeString()}</p>
                    <p><span className="font-semibold">Slot Status:</span> {appointment.slot.status}</p>
                </div>
            </div>

            {/* Doctor Info */}
            <div className="bg-white rounded-lg shadow-md border p-6 mb-6">
                <h2 className="text-xl font-semibold text-gray-800 mb-4">Doctor Information</h2>
                <div className="grid grid-cols-2 gap-4">
                    <p><span className="font-semibold">Name:</span> Dr. {appointment.doctor.user.name}</p>
                    <p><span className="font-semibold">Email:</span> {appointment.doctor.user.email}</p>
                    <p><span className="font-semibold">Phone:</span> {appointment.doctor.user.phoneNo}</p>
                    <p><span className="font-semibold">Specialty:</span> {appointment.doctor.specialty}</p>
                    <p><span className="font-semibold">Experience:</span> {appointment.doctor.experience} years</p>
                    <p><span className="font-semibold">Fees:</span> ₹{appointment.doctor.fees}</p>
                    <p><span className="font-semibold">Address:</span> {appointment.doctor.user.address}</p>
                    <p><span className="font-semibold">City:</span> {appointment.doctor.user.city}, {appointment.doctor.user.state}</p>
                    <p><span className="font-semibold">Qualifications:</span> {appointment.doctor.qualifications.join(', ')}</p>
                </div>
            </div>

        </div>
    );
}