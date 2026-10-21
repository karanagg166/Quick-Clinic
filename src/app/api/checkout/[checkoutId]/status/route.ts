import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { getAuthoritativeCheckoutStatus } from "@/lib/checkout-service";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ checkoutId: string }> }
) {
  try {
    const { checkoutId } = await params;
    if (!checkoutId) {
      return NextResponse.json({ error: "checkoutId required" }, { status: 400 });
    }

    const patient = await getAuthenticatedPatient(req);
    if (!patient) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const status = await getAuthoritativeCheckoutStatus(checkoutId, patient.userId);
    if (!status) {
      return NextResponse.json({ error: "Checkout record not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        ok: true,
        status: status.status,
        isConfirmed: status.status === "CONFIRMED" || Boolean(status.appointment),
        appointment: status.appointment,
        paymentStatus: status,
        refundStatus: status.refundStatus,
        checkout: status,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[checkout-status-api-error]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to retrieve checkout status" },
      { status: 500 }
    );
  }
}
