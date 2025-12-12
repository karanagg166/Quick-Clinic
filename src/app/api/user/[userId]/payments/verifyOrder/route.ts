// app/api/user/[userId]/payments/verifyOrder/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

export const POST = async (req: NextRequest, { params }: { params: Promise<{ userId: string }> }) => {
  try {
    const { userId } = await params;
    
    // 1. Get Payment Data from Body
    const { orderId, signature, paymentId } = await req.json();

    if (!orderId || !signature || !paymentId) {
      return NextResponse.json(
        { error: "Missing required payment details" },
        { status: 400 }
      );
    }

    // 2. Verify Signature
    // Use the SAME secret environment variable as the create route
    const secret = process.env.RAZORPAY_KEY_SECRET; 
    if (!secret) throw new Error("Server missing Razorpay secret");

    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    if (generatedSignature !== signature) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // 3. Update Database
    // Note: We use 'razorpayOrderId' because that is the unique field in your schema
    await prisma.payment.update({
      where: { 
        razorpayOrderId: orderId 
      },
      data: {
        status: "SUCCESS", // Or 'VERIFIED'
        razorpayPaymentId: paymentId,
      }
    });

    return NextResponse.json(
      { message: "Order verified successfully", transactionId: paymentId },
      { status: 200 }
    );

  } catch (err: any) {
    console.error("verify-order-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to verify order" },
      { status: 500 }
    );
  }
};