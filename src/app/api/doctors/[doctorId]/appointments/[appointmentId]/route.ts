import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from "@/lib/logger";
import type { AppointmentDetail } from '@/types/common';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ doctorId: string; appointmentId: string }> }
) {
  try {
    const { doctorId, appointmentId } = await params;

    if (!doctorId || !appointmentId) {
      return NextResponse.json({ error: 'doctorId and appointmentId are required' }, { status: 400 });
    }

    const appointment = await prisma.appointment.findFirst({
      where: {
        id: appointmentId,
        doctorId,
      },
      include: {
        doctor: {
          include: { user: { include: { location: true } } },
        },
        patient: {
          include: { user: { include: { location: true } } },
        },
        slot: true,
      },
    });

    if (!appointment) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const result: AppointmentDetail = {
      id: appointment.id,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      slotId: appointment.slotId,
      status: appointment.status as 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED',
      paymentMethod: appointment.paymentMethod as 'OFFLINE' | 'ONLINE',
      transactionId: appointment.transactionId ?? null,
      notes: appointment.notes ?? null,
      bookedAt: appointment.bookedAt.toISOString(),
      updatedAt: appointment.updatedAt.toISOString(),
      isAppointmentOffline: appointment.isAppointmentOffline,
      doctor: {
        id: appointment.doctor.id,
        userId: appointment.doctor.userId,
        specialty: String(appointment.doctor.specialty),
        experience: appointment.doctor.experience,
        qualifications: appointment.doctor.qualifications,
        fees: appointment.doctor.fees,
        user: {
          id: appointment.doctor.user.id,
          email: appointment.doctor.user.email,
          phoneNo: appointment.doctor.user.phoneNo,
          name: appointment.doctor.user.name,
          age: appointment.doctor.user.age,
          gender: String(appointment.doctor.user.gender) as 'MALE' | 'FEMALE' | 'BINARY',
          role: appointment.doctor.user.role as 'ADMIN' | 'DOCTOR' | 'PATIENT',
          address: appointment.doctor.user.address,
          city: appointment.doctor.user.location?.city || "N/A",
          state: appointment.doctor.user.location?.state || "N/A",
          pinCode: appointment.doctor.user.location?.pinCode || 0,
          emailVerified: appointment.doctor.user.emailVerified,
        },
      },
      patient: {
        id: appointment.patient.id,
        userId: appointment.patient.userId,
        medicalHistory: appointment.patient.medicalHistory,
        allergies: appointment.patient.allergies,
        currentMedications: appointment.patient.currentMedications,
        user: {
          id: appointment.patient.user.id,
          email: appointment.patient.user.email,
          phoneNo: appointment.patient.user.phoneNo,
          name: appointment.patient.user.name,
          age: appointment.patient.user.age,
          gender: String(appointment.patient.user.gender) as 'MALE' | 'FEMALE' | 'BINARY',
          role: appointment.patient.user.role as 'ADMIN' | 'DOCTOR' | 'PATIENT',
          address: appointment.patient.user.address,
          city: appointment.patient.user.location?.city || "N/A",
          state: appointment.patient.user.location?.state || "N/A",
          pinCode: appointment.patient.user.location?.pinCode || 0,
          emailVerified: appointment.patient.user.emailVerified,
        },
      },
      slot: {
        id: appointment.slot.id,
        doctorId: appointment.slot.doctorId,
        date: appointment.slot.date.toISOString().split('T')[0],
        startTime: appointment.slot.startTime.toISOString(),
        endTime: appointment.slot.endTime.toISOString(),
        status: String(appointment.slot.status) as 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE' | 'CANCELLED',
      },
      city: null,
      state: null,
    };

    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    console.error('Error fetching appointment detail:', e);
    return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 });
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ doctorId: string; appointmentId: string }> }
) {
  try {
    const { doctorId, appointmentId } = await params;
    if (!doctorId || !appointmentId) {
      return NextResponse.json({ error: 'doctorId and appointmentId are required' }, { status: 400 });
    }

    // Try to get from body first, fallback to query params for backward compatibility
    interface RequestBody {
      status?: string;
      paymentMethod?: string;
      isAppointmentOffline?: boolean;
    }

    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
      // If body parsing fails, use query params
      const url = new URL(req.url);
      body.status = url.searchParams.get('status') || undefined;
      body.paymentMethod = url.searchParams.get('paymentMethod') || undefined;
      const isAppointmentOfflineParam = url.searchParams.get('isAppointmentOffline');
      if (isAppointmentOfflineParam !== null) {
        body.isAppointmentOffline = isAppointmentOfflineParam === 'true';
      }
    }

    const { status, paymentMethod, isAppointmentOffline } = body;

    if (!status && !paymentMethod && isAppointmentOffline === undefined) {
      return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
    }

    // Validate status if provided
    if (status && !['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED'].includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const data: {
      status?: string;
      paymentMethod?: string;
      isAppointmentOffline?: boolean;
    } = {};

    if (status) data.status = status;
    if (paymentMethod) data.paymentMethod = paymentMethod;
    if (isAppointmentOffline !== undefined) {
      data.isAppointmentOffline = isAppointmentOffline;
    }

    // Get appointment before update to get patient info for socket notification
    const appointmentBefore = await prisma.appointment.findFirst({
      where: { id: appointmentId, doctorId },
      include: {
        patient: { include: { user: true } },
        doctor: { include: { user: true } },
        slot: true,
      },
    });

    if (!appointmentBefore) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    const updated = await prisma.appointment.updateMany({
      where: { id: appointmentId, doctorId },
      data,
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    // Update slot status based on appointment status
    if (status && status !== appointmentBefore.status) {
      if (status === 'CANCELLED') {
        // If cancelled, make slot available again
        await prisma.slot.update({
          where: { id: appointmentBefore.slotId },
          data: { status: 'AVAILABLE' },
        });
      } else if (status === 'CONFIRMED' && appointmentBefore.status === 'PENDING') {
        // If confirmed from pending, ensure slot is marked as booked
        await prisma.slot.update({
          where: { id: appointmentBefore.slotId },
          data: { status: 'BOOKED' },
        });
      } else if (status === 'COMPLETED' && appointmentBefore.status !== 'COMPLETED') {
        // When appointment is completed, transfer payment to doctor's balance if payment was online
        if (appointmentBefore.paymentMethod === 'ONLINE' && appointmentBefore.transactionId) {
          const doctorFees = appointmentBefore.doctor.fees; // Fees in rupees
          const feesInPaise = doctorFees * 100; // Convert to paise (smallest currency unit)

          // Add fees to doctor's balance
          await prisma.doctor.update({
            where: { id: doctorId },
            data: {
              balance: {
                increment: feesInPaise,
              },
            },
          });

          console.log(`Transferred ₹${doctorFees} to doctor ${doctorId} balance for completed appointment ${appointmentId}`);
        }
      }
    }

    // If status was updated, send socket notification to patient
    if (status && status !== appointmentBefore.status) {
      try {
        const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
        const patientUserId = appointmentBefore.patient.user.id;

        await fetch(`${socketServerUrl}/api/notifications/appointment-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientUserId,
            appointmentId,
            status,
            appointmentDate: appointmentBefore.slot.date.toISOString(),
            appointmentTime: appointmentBefore.slot.startTime.toISOString(),
            doctorName: appointmentBefore.doctor.user.name,
          }),
        }).catch((err) => {
          console.warn('Socket server notification failed (this is non-critical):', err);
        });
      } catch (notifError) {
        console.warn('Failed to send status update notification:', notifError);
      }
    }

    // Log Audit
    await logAudit(doctorId, "Updated Appointment Status", { appointmentId, status: status || appointmentBefore.status, paymentMethod, isAppointmentOffline });

    return NextResponse.json({ success: true, status: status || appointmentBefore.status }, { status: 200 });
  } catch (e) {
    console.error('Error updating appointment detail:', e);
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 });
  }
}
