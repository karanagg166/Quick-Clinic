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
          include: {
            user: { include: { location: true } },
            doctorQualifications: true,
          },
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

    const qualifications = appointment.doctor.doctorQualifications?.map((dq) => String(dq.qualification)) ?? [];

    const result: AppointmentDetail = {
      id: appointment.id,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      slotId: appointment.slotId,
      status: appointment.status as any,
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
        qualifications: qualifications,
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
          pinCode: appointment.doctor.user.location?.pincode || 0,
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
          pinCode: appointment.patient.user.location?.pincode || 0,
          emailVerified: appointment.patient.user.emailVerified,
        },
      },
      slot: {
        id: appointment.slot.id,
        doctorId: appointment.slot.doctorId,
        date: appointment.slot.date.toISOString().split('T')[0],
        startTime: appointment.slot.startTime.toISOString(),
        endTime: appointment.slot.endTime.toISOString(),
        status: String(appointment.slot.status) as any,
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

    interface RequestBody {
      status?: string;
      paymentMethod?: string;
      isAppointmentOffline?: boolean;
    }

    let body: RequestBody = {};
    try {
      body = await req.json();
    } catch {
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

    const allowedStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'RESCHEDULED', 'EXPIRED'];
    if (status && !allowedStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

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

    const data: Record<string, any> = {};
    if (status) data.status = status;
    if (paymentMethod) data.paymentMethod = paymentMethod;
    if (isAppointmentOffline !== undefined) {
      data.isAppointmentOffline = isAppointmentOffline;
    }

    const updatedAppointment = await prisma.appointment.update({
      where: { id: appointmentId },
      data,
    });

    // Update slot status based on appointment status
    if (status && status !== appointmentBefore.status) {
      if (status === 'CANCELLED') {
        // If cancelled, make slot available again
        await prisma.slot.update({
          where: { id: appointmentBefore.slotId },
          data: { status: 'AVAILABLE' },
        });
      } else if (status === 'CONFIRMED') {
        // If confirmed, ensure slot is marked as booked
        await prisma.slot.update({
          where: { id: appointmentBefore.slotId },
          data: { status: 'BOOKED' },
        });
      } else if (status === 'COMPLETED' && appointmentBefore.status !== 'COMPLETED') {
        // When appointment is completed, transfer payment to doctor's balance if payment was online
        if (appointmentBefore.paymentMethod === 'ONLINE' && appointmentBefore.transactionId) {
          const doctorFees = appointmentBefore.doctor.fees;
          const feesInPaise = doctorFees * 100;

          await prisma.doctor.update({
            where: { id: doctorId },
            data: {
              balance: {
                increment: feesInPaise,
              },
            },
          });
        }
      }
    }

    // Notifications
    if (status && status !== appointmentBefore.status) {
      const patientUserId = appointmentBefore.patient.user.id;
      const doctorUserId = appointmentBefore.doctor.user.id;
      const patientName = appointmentBefore.patient.user.name || 'Patient';
      const doctorName = appointmentBefore.doctor.user.name || 'Doctor';
      const apptDate = appointmentBefore.slot.date.toISOString().split('T')[0];

      const statusLabels: Record<string, string> = {
        CONFIRMED: 'confirmed',
        CANCELLED: 'cancelled',
        COMPLETED: 'completed',
        NO_SHOW: 'marked as no-show',
        RESCHEDULED: 'rescheduled',
        EXPIRED: 'expired',
      };
      const statusLabel = statusLabels[status] || status.toLowerCase();

      try {
        await prisma.notification.create({
          data: {
            userId: patientUserId,
            message: `Your appointment on ${apptDate} with ${doctorName} has been ${statusLabel}.`,
          },
        });
      } catch {}

      try {
        await prisma.notification.create({
          data: {
            userId: doctorUserId,
            message: `Appointment with ${patientName} on ${apptDate} has been ${statusLabel}.`,
          },
        });
      } catch {}

      try {
        const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
        await fetch(`${socketServerUrl}/api/notifications/appointment-status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patientUserId,
            appointmentId,
            status,
            appointmentDate: appointmentBefore.slot.date.toISOString(),
            appointmentTime: appointmentBefore.slot.startTime.toISOString(),
            doctorName,
          }),
        }).catch(() => {});
      } catch {}
    }

    await logAudit(doctorId, "Updated Appointment Status", { appointmentId, status: status || appointmentBefore.status, paymentMethod, isAppointmentOffline });

    return NextResponse.json({ success: true, status: status || appointmentBefore.status, appointment: updatedAppointment }, { status: 200 });
  } catch (e) {
    console.error('Error updating appointment detail:', e);
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 });
  }
}
