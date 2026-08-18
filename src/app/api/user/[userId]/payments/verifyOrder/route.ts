// app/api/user/[userId]/payments/verifyOrder/route.ts
import { NextResponse, NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import { z } from "zod";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { finalizeAppointmentBooking } from "@/lib/appointment-confirmation";

const verifyOrderSchema = z.object({
  orderId: z.string().min(1),
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
  paymentId: z.string().min(1),
});

export const POST = async (req: NextRequest, { params }: { params: Promise<{ userId: string }> }) => {
  try {
    const { userId } = await params;
    
    const body = verifyOrderSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json(
        { error: "Missing required payment details" },
        { status: 400 }
      );
    }
    const { orderId, signature, paymentId } = body.data;

    const patient = await getAuthenticatedPatient(req);
    if (!patient || patient.userId !== userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // 2. Verify Signature
    // Use the SAME secret environment variable as the create route
    const secret = process.env.RAZORPAY_KEY_SECRET; 
    if (!secret) throw new Error("Server missing Razorpay secret");

    const generatedSignature = crypto
      .createHmac("sha256", secret)
      .update(orderId + "|" + paymentId)
      .digest("hex");

    const expected = Buffer.from(generatedSignature, "hex");
    const received = Buffer.from(signature, "hex");
    if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId: orderId },
      select: {
        userId: true,
        status: true,
        razorpayPaymentId: true,
        doctorId: true,
        slotId: true,
        holdToken: true,
      },
    });
    if (!payment || payment.userId !== userId) {
      return NextResponse.json({ error: "Payment order not found" }, { status: 404 });
    }
    if (!payment.doctorId || !payment.slotId || !payment.holdToken) {
      return NextResponse.json({ error: "Payment order is missing booking context" }, { status: 409 });
    }

    // Explicit payment state machine
    // 1. REFUNDED: Replay must NOT transition back to SUCCESS, must NOT create appointment, must NOT issue another refund.
    if (payment.status === "REFUNDED") {
      return NextResponse.json(
        {
          error: "PAYMENT_ALREADY_REFUNDED",
          message: "This payment has already been refunded.",
          refundStatus: "REFUNDED",
          transactionId: payment.razorpayPaymentId || paymentId,
        },
        { status: 409 }
      );
    }

    // 2. REFUND_PENDING: Replay must NOT transition back to SUCCESS, must NOT create appointment, must NOT blindly issue duplicate refunds.
    if (payment.status === "REFUND_PENDING") {
      return NextResponse.json(
        {
          error: "REFUND_PENDING",
          message: "A refund is currently pending for this payment.",
          refundStatus: "REFUND_PENDING",
          transactionId: payment.razorpayPaymentId || paymentId,
        },
        { status: 409 }
      );
    }

    // 3. SUCCESS: Duplicate verification after successful appointment must be idempotent.
    if (payment.status === "SUCCESS") {
      const existingAppointment = await prisma.appointment.findFirst({
        where: {
          slotId: payment.slotId,
          patientId: patient.id,
        },
      });

      if (existingAppointment) {
        return NextResponse.json(
          {
            message: "Payment verified and appointment confirmed",
            transactionId: payment.razorpayPaymentId || paymentId,
            appointment: existingAppointment,
          },
          { status: 200 }
        );
      }
    }

    // 4. PENDING (or unfinalized SUCCESS): Transition to SUCCESS and attempt finalization
    if (payment.status !== "SUCCESS" || payment.razorpayPaymentId !== paymentId) {
      await prisma.payment.update({
        where: { razorpayOrderId: orderId },
        data: { status: "SUCCESS", razorpayPaymentId: paymentId },
      });
    }

    const appointment = await finalizeAppointmentBooking({
      slotId: payment.slotId,
      doctorId: payment.doctorId,
      patientId: patient.id,
      patientUserId: patient.userId,
      holdToken: payment.holdToken,
      paymentMethod: "ONLINE",
      transactionId: paymentId,
    });

    if (!appointment) {
      console.error(
        "CRITICAL: Payment verified but appointment finalization failed. Executing automatic refund compensation.",
        { orderId, paymentId, slotId: payment.slotId, doctorId: payment.doctorId, patientId: patient.id }
      );

      let refundStatus: "REFUNDED" | "REFUND_PENDING" = "REFUND_PENDING";
      try {
        if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
          const RazorpayModule = await import("razorpay");
          const Razorpay = RazorpayModule.default;
          const razorpay = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET,
          });

          await razorpay.payments.refund(paymentId, {
            notes: {
              reason: "Automatic compensation: slot unavailable during finalization",
              orderId,
            },
            receipt: `ref_${orderId}`,
          });
          refundStatus = "REFUNDED";
        }
      } catch (refundErr) {
        console.error("Failed to execute Razorpay refund compensation:", refundErr);
      }

      await prisma.payment.update({
        where: { razorpayOrderId: orderId },
        data: { status: refundStatus },
      });

      return NextResponse.json(
        {
          error: "SLOT_UNAVAILABLE_REFUNDED",
          message: "The requested slot is no longer available. Your payment has been automatically refunded.",
          refundStatus,
          transactionId: paymentId,
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { message: "Payment verified and appointment confirmed", transactionId: paymentId, appointment },
      { status: 200 }
    );

  } catch (err: unknown) {
    console.error("verify-order-error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to verify order" },
      { status: 500 }
    );
  }
};
