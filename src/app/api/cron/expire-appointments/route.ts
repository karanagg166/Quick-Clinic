import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Vercel Cron Job: Auto-expire PENDING appointments whose slot date has passed.
 * Schedule: Runs daily at midnight UTC (configured in vercel.json)
 *
 * For online-paid appointments, a Razorpay refund is attempted automatically.
 */
export async function GET(req: Request) {
    try {
        // Verify cron secret (Vercel sends this header for cron jobs)
        const authHeader = req.headers.get('authorization');
        if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const now = new Date();
        // Set to start of today (UTC) so we expire anything before today
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

        // Find all PENDING appointments whose slot date is in the past
        const expiredAppointments = await prisma.appointment.findMany({
            where: {
                status: 'PENDING',
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
            });
        }

        let expiredCount = 0;
        let refundedCount = 0;
        let refundFailedCount = 0;

        for (const appointment of expiredAppointments) {
            try {
                // 1. Mark appointment as EXPIRED
                await prisma.appointment.update({
                    where: { id: appointment.id },
                    data: { status: 'EXPIRED' },
                });

                // 2. Release the slot back to AVAILABLE
                await prisma.slot.update({
                    where: { id: appointment.slotId },
                    data: { status: 'AVAILABLE' },
                });

                expiredCount++;

                // 3. Process refund if payment was online
                if (appointment.paymentMethod === 'ONLINE' && appointment.transactionId) {
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
                                console.log(`Refund processed for expired appointment ${appointment.id}`);
                            } else {
                                console.warn('Razorpay credentials missing, skipping refund for appointment:', appointment.id);
                                refundFailedCount++;
                            }
                        }
                    } catch (refundError) {
                        console.error(`Refund failed for appointment ${appointment.id}:`, refundError);
                        refundFailedCount++;
                    }
                }

                // 4. Send notification to patient about expiry
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
            message: `Expired ${expiredCount} appointments`,
            expired: expiredCount,
            refunded: refundedCount,
            refundFailed: refundFailedCount,
        });
    } catch (error) {
        console.error('Cron expire-appointments error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
