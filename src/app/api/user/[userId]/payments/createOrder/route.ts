// app/api/user/[userId]/payments/createOrder/route.ts
import { NextResponse, type NextRequest } from "next/server";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { createOrReusePaymentOrder } from "@/lib/payment-booking-service";
import { z } from "zod";

const createOrderSchema = z.object({
  doctorId: z.string().min(1),
  slotId: z.string().min(1),
  holdToken: z.string().uuid(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    if (!userId) return NextResponse.json({ message: "userId required" }, { status: 400 });

    const body = createOrderSchema.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json(
        { message: "doctorId, slotId, and a valid holdToken are required" },
        { status: 400 }
      );
    }
    const { doctorId, slotId, holdToken, idempotencyKey } = body.data;

    const patient = await getAuthenticatedPatient(req);
    if (!patient || patient.userId !== userId) {
      return NextResponse.json({ message: "Authentication required" }, { status: 401 });
    }

    // Stable idempotency key tied to authenticated user, slot, and hold token
    const clientKey = idempotencyKey || `ord_${userId.slice(-6)}_${slotId}_${holdToken}`;

    const result = await createOrReusePaymentOrder({
      userId,
      patientId: patient.id,
      doctorId,
      slotId,
      holdToken,
      idempotencyKey: clientKey,
    });

    return NextResponse.json(
      {
        ok: true,
        order: {
          ...result.order,
          id: result.order.razorpayOrderId,
          dbId: result.order.id,
          razorpayOrderId: result.order.razorpayOrderId,
          status: "created",
        },
        keyId: result.keyId,
        reused: result.reused ?? false,
      },
      { status: result.reused ? 200 : 201 }
    );
  } catch (error: any) {
    console.error("Error creating order:", error);
    const status = typeof error?.statusCode === "number" ? error.statusCode : 500;
    const msg = error instanceof Error ? error.message : "Failed to create payment order";
    return NextResponse.json(
      { message: msg, error: msg },
      { status }
    );
  }
}
