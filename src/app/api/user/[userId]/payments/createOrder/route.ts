// app/api/user/[userId]/payments/createOrder/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import Razorpay from 'razorpay';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) return NextResponse.json({ message: 'userId required' }, { status: 400 });

    const body = await req.json();
    const { amount } = body;
 
    if (!amount || isNaN(amount)) {
      return NextResponse.json({ message: 'Amount required' }, { status: 400 });
    }

    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return NextResponse.json({ message: 'Razorpay credentials missing' }, { status: 500 });
    }

    const razorpay = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });

    const options = {
      amount: Math.round(amount * 100),
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