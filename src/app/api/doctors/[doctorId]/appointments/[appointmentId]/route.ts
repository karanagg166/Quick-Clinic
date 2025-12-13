import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
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
          include: { user: true },
        },
        patient: {
          include: { user: true },
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
      status: appointment.status as any,
      paymentMethod: appointment.paymentMethod as any,
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
          gender: String(appointment.doctor.user.gender),
          address: appointment.doctor.user.address,
          city: appointment.doctor.user.city,
          state: appointment.doctor.user.state,
          pinCode: appointment.doctor.user.pinCode,
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
          gender: String(appointment.patient.user.gender),
          address: appointment.patient.user.address,
          city: appointment.patient.user.city,
          state: appointment.patient.user.state,
          pinCode: appointment.patient.user.pinCode,
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

    const url = new URL(req.url);
    const status = url.searchParams.get('status');
    const paymentMethod = url.searchParams.get('paymentMethod');
    const isAppointmentOfflineParam = url.searchParams.get('isAppointmentOffline');

    if (!status && !paymentMethod && !isAppointmentOfflineParam) {
      return NextResponse.json({ error: 'No fields provided to update' }, { status: 400 });
    }

    const data: Record<string, any> = {};

    if (status) data.status = status;
    if (paymentMethod) data.paymentMethod = paymentMethod;
    if (isAppointmentOfflineParam !== null) {
      data.isAppointmentOffline = isAppointmentOfflineParam === 'true';
    }

    const updated = await prisma.appointment.updateMany({
      where: { id: appointmentId, doctorId },
      data,
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (e) {
    console.error('Error updating appointment detail:', e);
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 });
  }
}
