import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Vercel Cron Job: Auto-expire appointments whose slot date has passed.
 * Handles both PENDING and CONFIRMED appointments where the slot date is in the past.
 * Schedule: Runs daily at midnight UTC (configured in vercel.json)
 *
 * For online-paid PENDING appointments, a Razorpay refund is attempted automatically.
 */
export async function GET(req: Request) {
    try {
        // Verify cron secret (Vercel sends this header for cron jobs)
        const authHeader = req.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);

        // Find all PENDING and CONFIRMED appointments whose slot date is in the past
        const expiredAppointments = await prisma.appointment.findMany({
            where: {
                status: {
                    in: ['PENDING', 'CONFIRMED'],
                },
                slot: {
                    date: {
                        lt: today,
                    },
                },
            },
            include: {
                slot: true,
                patient: {
                    include: { user: true },
                },
                doctor: {
                    include: { user: true },
                },
            },
        });

        if (expiredAppointments.length === 0) {
            return NextResponse.json({
                message: 'No expired appointments found',
                expired: 0,
                refunded: 0,
            });
        }

        let expiredCount = 0;
        let refundedCount = 0;
        let refundFailedCount = 0;

        for (const appointment of expiredAppointments) {
            try {
                const previousStatus = appointment.status;

                // 1. Mark appointment as EXPIRED
                await prisma.appointment.update({
                    where: { id: appointment.id },
                    data: {
                        status: 'EXPIRED',
                        notes: appointment.notes
                            ? `${appointment.notes} | Auto-expired: appointment date passed without completion.`
                            : 'Auto-expired: appointment date passed without completion.',
                    },
                });

                // 2. Release the slot back to AVAILABLE
                await prisma.slot.update({
                    where: { id: appointment.slotId },
                    data: { status: 'AVAILABLE' },
                });

                expiredCount++;

                // 3. Process refund for online-paid PENDING appointments (doctor never confirmed)
                if (previousStatus === 'PENDING' && appointment.paymentMethod === 'ONLINE' && appointment.transactionId) {
                    try {
                        const payment = await prisma.payment.findFirst({
                            where: {
                                razorpayPaymentId: appointment.transactionId,
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
                                        reason: 'Appointment expired - doctor did not approve',
                                        appointmentId: appointment.id,
                                    },
                                });

                                await prisma.payment.update({
                                    where: { id: payment.id },
                                    data: { status: 'REFUNDED' },
                                });

                                refundedCount++;
                            } else {
                                refundFailedCount++;
                            }
                        }
                    } catch (refundError) {
                        console.error(`Refund failed for appointment ${appointment.id}:`, refundError);
                        refundFailedCount++;
                    }
                }

                // 4. Send database notification to patient
                try {
                    const patientUserId = appointment.patient?.user?.id;
                    const doctorName = appointment.doctor?.user?.name || 'Doctor';
                    const apptDate = appointment.slot?.date?.toISOString().split('T')[0] || '';

                    if (patientUserId) {
                        await prisma.notification.create({
                            data: {
                                userId: patientUserId,
                                message: `Your appointment with ${doctorName} on ${apptDate} has expired as the appointment date passed.`,
                            },
                        });
                    }

                    const doctorUserId = appointment.doctor?.user?.id;
                    if (doctorUserId && previousStatus === 'CONFIRMED') {
                        await prisma.notification.create({
                            data: {
                                userId: doctorUserId,
                                message: `Your appointment with ${appointment.patient?.user?.name || 'Patient'} on ${apptDate} was marked expired as the scheduled date passed.`,
                            },
                        });
                    }
                } catch {
                    // Non-critical notification failure
                }

                // 5. Send socket notification if socket server is configured
                try {
                    const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';
                    await fetch(`${socketServerUrl}/api/notifications/appointment-status`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            patientUserId: appointment.patient.user.id,
                            appointmentId: appointment.id,
                            status: 'EXPIRED',
                            appointmentDate: appointment.slot.date.toISOString(),
                            appointmentTime: appointment.slot.startTime.toISOString(),
                            doctorName: appointment.doctor.user.name,
                        }),
                    }).catch(() => { });
                } catch {
                    // Non-critical, ignore
                }
            } catch (err) {
                console.error(`Failed to expire appointment ${appointment.id}:`, err);
            }
        }

        return NextResponse.json({
            message: `Processed ${expiredCount} expired appointments`,
            expired: expiredCount,
            refunded: refundedCount,
            refundFailed: refundFailedCount,
        });
    } catch (error) {
        console.error('Cron expire-appointments error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
