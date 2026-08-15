import { NextResponse } from 'next/server';
import { autoExpirePastAppointments } from '@/lib/appointment-expiry';

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

    const result = await autoExpirePastAppointments();

    return NextResponse.json({
      message: `Processed ${result.expired} expired appointments`,
      expired: result.expired,
      refunded: result.refunded,
      refundFailed: result.refundFailed,
    }, { status: 200 });
  } catch (error) {
    console.error('Cron expire-appointments error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
