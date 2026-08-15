// app/api/user/[userId]/payments/createOrder/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import Razorpay from 'razorpay';
import { getAuthenticatedPatient } from '@/lib/request-auth';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) return NextResponse.json({ message: 'userId required' }, { status: 400 });

    const body = await req.json().catch(() => null);
    const doctorId = typeof body?.doctorId === 'string' ? body.doctorId : '';
    const slotId = typeof body?.slotId === 'string' ? body.slotId : '';
    if (!doctorId || !slotId) {
      return NextResponse.json({ message: 'doctorId and slotId are required' }, { status: 400 });
    }

    const patient = await getAuthenticatedPatient(req);
    if (!patient || patient.userId !== userId) {
      return NextResponse.json({ message: 'Authentication required' }, { status: 401 });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return NextResponse.json({ message: 'Razorpay credentials missing' }, { status: 500 });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const [doctor, slot] = await Promise.all([
      prisma.doctor.findUnique({ where: { id: doctorId }, select: { fees: true } }),
      prisma.slot.findFirst({
        where: { id: slotId, doctorId, status: 'HELD', heldByPatientId: patient.id },
        select: { id: true },
      }),
    ]);
    if (!doctor || !slot) {
      return NextResponse.json({ message: 'Your appointment hold has expired. Please choose the slot again.' }, { status: 409 });
    }

    const amount = Math.round(doctor.fees * 100);
    if (!Number.isSafeInteger(amount) || amount < 100) {
      return NextResponse.json({ message: 'The doctor has not configured a valid consultation fee.' }, { status: 400 });
    }

    const options = {
      amount,
      currency: "INR",
      receipt: `rcpt_${Date.now()}_${userId.slice(-5)}`,
    };

    const order = await razorpay.orders.create(options);

    const savedOrder = await prisma.payment.create({
      data: {
        userId: userId,
        amount: Number(order.amount),
        currency: order.currency,
        status: order.status, // usually "created"
        razorpayOrderId: order.id,
      },
    });

    // CHANGE: Return the Key ID so the frontend can use it
    return NextResponse.json({ 
      ok: true, 
      order: savedOrder,
      keyId: process.env.RAZORPAY_KEY_ID 
    }, { status: 201 });

  } catch (error: any) {
    console.error("Error creating order:", error);
    return NextResponse.json({ message: error.message }, { status: 500 });
  }
}
