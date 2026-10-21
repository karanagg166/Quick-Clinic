import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { checkoutRequestSchema } from "@/lib/checkout-types";
import { initiateCheckout, verifyAndFinalizeCheckout } from "@/lib/checkout-service";

export async function POST(req: NextRequest) {
  try {
    const patient = await getAuthenticatedPatient(req);
    if (!patient) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const rawBody = await req.json().catch(() => null);
    const parsed = checkoutRequestSchema.safeParse(rawBody);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid checkout request",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const data = parsed.data;

    // Dispatch based on discriminated action
    if (data.action === "INITIATE") {
      const result = await initiateCheckout({
        userId: patient.userId,
        patientId: patient.id,
        doctorId: data.doctorId,
        slotId: data.slotId,
        paymentMethod: data.paymentMethod,
        idempotencyKey: data.idempotencyKey,
      });

      const statusCode = result.reused ? 200 : 201;
      return NextResponse.json(result, { status: statusCode });
    }

    if (data.action === "VERIFY") {
      const result = await verifyAndFinalizeCheckout({
        userId: patient.userId,
        patientId: patient.id,
        checkoutId: data.checkoutId,
        orderId: data.orderId,
        paymentId: data.paymentId,
        signature: data.signature,
        source: "CHECKOUT",
      });

      if (!result.success) {
        return NextResponse.json(
          {
            error: result.error || "Payment verification failed",
            message: result.message,
            refundStatus: result.refundStatus,
            transactionId: result.transactionId || data.paymentId,
          },
          { status: result.statusCode }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          message: result.message || "Payment verified and appointment confirmed",
          transactionId: result.transactionId || data.paymentId,
          appointment: result.appointment,
        },
        { status: result.statusCode }
      );
    }

    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  } catch (error: any) {
    console.error("[checkout-api-error]", error);
    const statusCode = typeof error?.statusCode === "number" ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : "An unexpected error occurred during checkout";
    return NextResponse.json({ error: message, message }, { status: statusCode });
  }
}
