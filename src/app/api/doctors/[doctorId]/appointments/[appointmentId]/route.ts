import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { logAudit } from "@/lib/logger";
import type { AppointmentDetail } from '@/types/common';
import { getAuthenticatedUser } from '@/lib/auth';
import { validateStatusTransition } from '@/lib/appointment-state-machine';

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

    const authUser = await getAuthenticatedUser(req);
    if (authUser) {
      const isDoctor = appointment.doctor.userId === authUser.id;
      const isPatient = appointment.patient.userId === authUser.id;
      const isAdmin = authUser.role === 'ADMIN';

      if (!isDoctor && !isPatient && !isAdmin) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    const qualifications = appointment.doctor.doctorQualifications?.map((dq: any) => String(dq.qualification)) ?? [];

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

    const authUser = await getAuthenticatedUser(req);
    if (authUser && appointmentBefore.doctor.userId !== authUser.id && authUser.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    // Enforce centralized appointment state machine transition
    if (status && status !== appointmentBefore.status) {
      const validation = validateStatusTransition(appointmentBefore.status as any, status as any);
      if (!validation.valid) {
        return NextResponse.json({ error: validation.error }, { status: 400 });
      }
    }

    const doctorUserId = appointmentBefore.doctor.user.id;

    const data: Record<string, any> = {};
    if (status) data.status = status;

    let updatedAppointment: any = appointmentBefore;

    // Handle COMPLETED transition atomically inside a transaction to prevent concurrency races
    if (status === 'COMPLETED') {
      if (appointmentBefore.status === 'COMPLETED') {
        return NextResponse.json({ success: true, status: 'COMPLETED', appointment: appointmentBefore }, { status: 200 });
      }

      const txResult = await prisma.$transaction(async (tx) => {
        const updateRes = await tx.appointment.updateMany({
          where: {
            id: appointmentId,
            status: { not: 'COMPLETED' },
          },
          data: { status: 'COMPLETED' },
        });

        if (updateRes.count === 0) {
          return null; // Already completed concurrently
        }

        await tx.slot.update({
          where: { id: appointmentBefore.slotId },
          data: { status: 'UNAVAILABLE', heldByPatientId: null, heldAt: null },
        });

        if (appointmentBefore.paymentMethod === 'ONLINE' && appointmentBefore.transactionId) {
          const doctorFees = appointmentBefore.doctor.fees;
          const feesInPaise = doctorFees * 100;

          await tx.doctor.update({
            where: { id: doctorId },
            data: {
              balance: {
                increment: feesInPaise,
              },
            },
          });
        }

        return await tx.appointment.findUnique({ where: { id: appointmentId } });
      }, { maxWait: 15000, timeout: 20000 });

      if (!txResult) {
        // Concurrently completed, return idempotent success
        const latest = await prisma.appointment.findUnique({ where: { id: appointmentId } });
        return NextResponse.json({ success: true, status: 'COMPLETED', appointment: latest }, { status: 200 });
      }

      updatedAppointment = txResult as any;
    } else {
      const data: Record<string, any> = {};
      if (status) data.status = status;

      updatedAppointment = await prisma.appointment.update({
        where: { id: appointmentId },
        data,
      });

      if (status && status !== appointmentBefore.status) {
        if (status === 'CANCELLED') {
          await prisma.slot.update({
            where: { id: appointmentBefore.slotId },
            data: { status: 'AVAILABLE' },
          });

          // Process refund if payment was online
          if (appointmentBefore.paymentMethod === 'ONLINE' && appointmentBefore.transactionId) {
            try {
              const patientUserId = appointmentBefore.patient.user.id;
              const payment = await prisma.payment.findFirst({
                where: {
                  razorpayPaymentId: appointmentBefore.transactionId,
                  userId: patientUserId,
                  status: 'SUCCESS',
                },
              });

              if (payment && payment.razorpayPaymentId) {
                if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
                  const RazorpayModule = await import('razorpay');
                  const Razorpay = RazorpayModule.default;
                  const razorpay = new Razorpay({
                    key_id: process.env.RAZORPAY_KEY_ID,
                    key_secret: process.env.RAZORPAY_KEY_SECRET,
                  });

                  await razorpay.payments.refund(payment.razorpayPaymentId, {
                    amount: payment.amount,
                    notes: {
                      reason: 'Appointment cancelled by doctor',
                      appointmentId: appointmentId,
                    },
                  });

                  await prisma.payment.update({
                    where: { id: payment.id },
                    data: { status: 'REFUNDED' },
                  });
                }
              }
            } catch (refundError) {
              console.error('Doctor cancellation refund error:', refundError);
            }
          }
        } else if (status === 'CONFIRMED') {
          await prisma.slot.update({
            where: { id: appointmentBefore.slotId },
            data: { status: 'BOOKED', heldByPatientId: null, heldAt: null },
          });
        } else if (status === 'NO_SHOW') {
          await prisma.slot.update({
            where: { id: appointmentBefore.slotId },
            data: { status: 'UNAVAILABLE', heldByPatientId: null, heldAt: null },
          });
        }
      }
    }

    // Notifications & Chat Messages
    if (status && status !== appointmentBefore.status) {
      const patientUserId = appointmentBefore.patient.user.id;
      const doctorUserId = appointmentBefore.doctor.user.id;
      const patientName = appointmentBefore.patient.user.name || 'Patient';
      const doctorName = appointmentBefore.doctor.user.name || 'Doctor';
      const apptDate = appointmentBefore.slot.date.toISOString().split('T')[0];

      // 1. Post Automated Chat Message into Doctor-Patient Relation
      try {
        let relation = await prisma.doctorPatientRelation.findUnique({
          where: {
            doctorsUserId_patientsUserId: {
              doctorsUserId: doctorUserId,
              patientsUserId: patientUserId,
            },
          },
        });

        if (!relation) {
          try {
            relation = await prisma.doctorPatientRelation.create({
              data: {
                doctorsUserId: doctorUserId,
                patientsUserId: patientUserId,
              },
            });
          } catch {
            relation = await prisma.doctorPatientRelation.findUnique({
              where: {
                doctorsUserId_patientsUserId: {
                  doctorsUserId: doctorUserId,
                  patientsUserId: patientUserId,
                },
              },
            });
          }
        }

        let chatText = "";
        if (status === 'COMPLETED') {
          chatText = `🎉 Consultation Completed!\n\nThank you for consulting with Dr. ${doctorName}. How was your experience?\n\n👉 [Click here to review & rate Dr. ${doctorName}](/patient/doctor/${doctorId})`;
        } else if (status === 'NO_SHOW') {
          chatText = `⚠️ Missed Appointment (Never Showed Up)\n\nWe noticed you were unable to attend your scheduled appointment with Dr. ${doctorName} on ${apptDate}.\n\n👉 Need to rebook a new appointment? [Click here to select a new slot](/patient/doctor/${doctorId})`;
        } else if (status === 'CANCELLED') {
          chatText = appointmentBefore.paymentMethod === 'ONLINE'
            ? `❌ Appointment Cancelled\n\nYour appointment with Dr. ${doctorName} on ${apptDate} has been cancelled. A full refund has been initiated to your original payment method.\n\n👉 [Click here to find available doctors & slots](/patient/findDoctors)`
            : `❌ Appointment Cancelled\n\nYour appointment with Dr. ${doctorName} on ${apptDate} has been cancelled.\n\n👉 [Click here to find available doctors & slots](/patient/findDoctors)`;
        }

        if (relation && chatText) {
          await prisma.chatMessages.create({
            data: {
              doctorPatientRelationId: relation.id,
              text: chatText,
              senderId: doctorUserId,
            },
          });
        }
      } catch (chatErr) {
        console.warn("Failed to create automated status chat message:", chatErr);
      }

      // 2. In-App Notifications
      let patientNotificationMessage = `Your appointment on ${apptDate} with Dr. ${doctorName} has been updated to ${status.toLowerCase()}.`;
      let patientActionHref = `/patient/appointments/${appointmentId}`;
      let patientActionLabel = 'View appointment';
      if (status === 'COMPLETED') {
        patientNotificationMessage = `Your consultation with Dr. ${doctorName} is completed. Share your experience with Dr. ${doctorName}.`;
        patientActionHref = `/patient/doctor/${doctorId}`;
        patientActionLabel = 'Rate and review';
      } else if (status === 'NO_SHOW') {
        patientNotificationMessage = `You were marked as no-show for your appointment with Dr. ${doctorName}.`;
        patientActionHref = `/patient/doctor/${doctorId}`;
        patientActionLabel = 'Book another visit';
      } else if (status === 'CANCELLED') {
        patientNotificationMessage = appointmentBefore.paymentMethod === 'ONLINE'
          ? `Your appointment on ${apptDate} with Dr. ${doctorName} was cancelled. A full refund has been initiated to your payment method.`
          : `Your appointment on ${apptDate} with Dr. ${doctorName} has been cancelled.`;
      }

      try {
        const patientNotification = await prisma.notification.create({
          data: {
            userId: patientUserId,
            message: patientNotificationMessage,
            actionHref: patientActionHref,
            actionLabel: patientActionLabel,
          },
        });
        const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
        await fetch(`${socketServerUrl}/api/notifications/broadcast`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            userId: patientUserId,
            notification: {
              id: patientNotification.id,
              message: patientNotification.message,
              actionHref: patientNotification.actionHref,
              actionLabel: patientNotification.actionLabel,
              createdAt: patientNotification.createdAt.toISOString(),
              isRead: patientNotification.isRead,
            },
          }),
        }).catch(() => {});
      } catch {}

      try {
        await prisma.notification.create({
          data: {
            userId: doctorUserId,
            message: `Appointment with ${patientName} on ${apptDate} has been marked as ${status.toLowerCase()}.`,
          },
        });
      } catch {}

    }

    await logAudit(doctorUserId, "Updated Appointment Status", { appointmentId, status: status || appointmentBefore.status, paymentMethod, isAppointmentOffline });

    return NextResponse.json({ success: true, status: status || appointmentBefore.status, appointment: updatedAppointment }, { status: 200 });
  } catch (e) {
    console.error('Error updating appointment detail:', e);
    return NextResponse.json({ error: 'Failed to update appointment' }, { status: 500 });
  }
}
