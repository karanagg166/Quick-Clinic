// app/api/user/[userId]/payments/verifyOrder/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { verifyAndTransitionPayment } from "@/lib/payment-booking-service";

const verifyOrderSchema = z.object({
  orderId: z.string().min(1),
  signature: z.string().regex(/^[a-f0-9]{64}$/i),
  paymentId: z.string().min(1),
});

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) => {
  try {
    const { userId } = await params;
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

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

    const result = await verifyAndTransitionPayment({
      orderId,
      paymentId,
      signature,
      patientUserId: userId,
      source: "CHECKOUT",
    });

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error || "Payment verification failed",
          message: result.message,
          refundStatus: result.refundStatus,
          transactionId: result.transactionId || paymentId,
        },
        { status: result.statusCode }
      );
    }

    return NextResponse.json(
      {
        message: result.message || "Payment verified and appointment confirmed",
        transactionId: result.transactionId || paymentId,
        appointment: result.appointment,
      },
      { status: result.statusCode }
    );
  } catch (err: unknown) {
    console.error("[verifyOrder] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to verify order" },
      { status: 500 }
    );
  }
};
