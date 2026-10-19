import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { getAuthoritativePaymentStatus } from "@/lib/payment-booking-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string; orderId: string }> }
) {
  try {
    const { userId, orderId } = await params;
    if (!userId || !orderId) {
      return NextResponse.json({ error: "userId and orderId required" }, { status: 400 });
    }

    const patient = await getAuthenticatedPatient(req);
    if (!patient || patient.userId !== userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const status = await getAuthoritativePaymentStatus(orderId, userId);
    if (!status) {
      return NextResponse.json({ error: "Payment order not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        status: status.status,
        isConfirmed: Boolean(status.appointment),
        appointmentId: status.appointment?.id,
        appointment: status.appointment,
        paymentStatus: status,
        amount: status.amount,
        currency: status.currency,
        orderId: status.orderId,
        paymentId: status.paymentId,
        capturedAt: status.capturedAt,
        refund: status.refund,
      },
      { status: 200 }
    );
  } catch (error: unknown) {
    console.error("[PaymentStatus] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to retrieve payment status" },
      { status: 500 }
    );
  }
}
