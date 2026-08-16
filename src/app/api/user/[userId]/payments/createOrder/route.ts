// app/api/user/[userId]/payments/createOrder/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import Razorpay from 'razorpay';
import { getAuthenticatedPatient } from '@/lib/request-auth';
import { validateSlotHold } from '@/lib/booking';
import { z } from 'zod';

const createOrderSchema = z.object({
  doctorId: z.string().min(1),
  slotId: z.string().min(1),
  holdToken: z.string().uuid(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) return NextResponse.json({ message: 'userId required' }, { status: 400 });

    const body = createOrderSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ message: 'doctorId, slotId, and a valid holdToken are required' }, { status: 400 });
    }
    const { doctorId, slotId, holdToken } = body.data;

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

    const [doctor, slot, ownsHold] = await Promise.all([
      prisma.doctor.findUnique({ where: { id: doctorId }, select: { fees: true } }),
      prisma.slot.findFirst({
        where: { id: slotId, doctorId, status: 'HELD', heldByPatientId: patient.id },
        select: { id: true },
      }),
      validateSlotHold(slotId, patient.id, holdToken),
    ]);
    if (!doctor || !slot || !ownsHold) {
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
        doctorId,
        slotId,
        holdToken,
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

  } catch (error: unknown) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : 'Failed to create payment order' },
      { status: 500 }
    );
  }
}
