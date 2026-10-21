import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedPatient } from "@/lib/request-auth";
import { finalizeAppointmentBooking } from "@/lib/appointment-confirmation";
import { verifyAndFinalizeCheckout } from "@/lib/checkout-service";
import { verifyAndTransitionPayment } from "@/lib/payment-booking-service";

const confirmSchema = z.object({
  slotId: z.string().min(1),
  doctorId: z.string().min(1),
  holdToken: z.string().uuid(),
  paymentMethod: z.enum(["ONLINE", "OFFLINE"]),
  transactionId: z.string().min(1).nullable().optional(),
});

export async function POST(req: NextRequest) {
  const patient = await getAuthenticatedPatient(req);
  if (!patient) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const body = confirmSchema.safeParse(await req.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid confirmation request" }, { status: 400 });

  if (body.data.paymentMethod === "ONLINE") {
    if (!body.data.transactionId) {
      return NextResponse.json({ error: "A transaction ID is required for online payment" }, { status: 400 });
    }

    try {
      const transactionId = body.data.transactionId;

      // 1. Check for canonical Checkout record for this user, doctor, slot, and holdToken
      const matchingCheckout = await prisma.checkout.findFirst({
        where: {
          slotId: body.data.slotId,
          doctorId: body.data.doctorId,
          patientId: patient.id,
          userId: patient.userId,
          holdToken: body.data.holdToken,
          paymentMethod: "ONLINE",
        },
      });

      if (matchingCheckout) {
        // Route through canonical checkout verification service
        const verifyRes = await verifyAndFinalizeCheckout({
          userId: patient.userId,
          patientId: patient.id,
          checkoutId: matchingCheckout.id,
          orderId: matchingCheckout.razorpayOrderId ?? undefined,
          paymentId: transactionId,
          source: "CHECKOUT",
        });

        if (!verifyRes.success) {
          return NextResponse.json(
            {
              error: verifyRes.error || "Payment verification failed",
              message: verifyRes.message,
              refundStatus: verifyRes.refundStatus,
            },
            { status: verifyRes.statusCode || 400 }
          );
        }

        return NextResponse.json({ appointment: verifyRes.appointment }, { status: 201 });
      }

      // 2. Pre-migration compatibility: check for legacy Payment record
      const matchingPayment = await prisma.payment.findFirst({
        where: {
          slotId: body.data.slotId,
          doctorId: body.data.doctorId,
          userId: patient.userId,
          holdToken: body.data.holdToken,
        },
      });

      if (!matchingPayment || !matchingPayment.razorpayOrderId) {
        return NextResponse.json(
          { error: "No matching payment order found for this reservation. Payment verification failed." },
          { status: 400 }
        );
      }

      // Route pre-migration payment through authoritative verification
      const verifyRes = await verifyAndTransitionPayment({
        orderId: matchingPayment.razorpayOrderId,
        paymentId: transactionId,
        patientUserId: patient.userId,
        source: "CHECKOUT",
      });

      if (!verifyRes.success) {
        return NextResponse.json(
          {
            error: verifyRes.error || "Payment verification failed",
            message: verifyRes.message,
            refundStatus: verifyRes.refundStatus,
          },
          { status: verifyRes.statusCode || 400 }
        );
      }

      return NextResponse.json({ appointment: verifyRes.appointment }, { status: 201 });
    } catch (error) {
      console.error("appointment-confirm-online-error", error);
      return NextResponse.json({ error: "Unable to confirm this online appointment" }, { status: 500 });
    }
  }

  // OFFLINE booking flow
  try {
    const appointment = await finalizeAppointmentBooking({
      ...body.data,
      patientId: patient.id,
      patientUserId: patient.userId,
    });
    if (!appointment) return NextResponse.json({ error: "Hold expired or does not belong to this patient" }, { status: 409 });

    return NextResponse.json({ appointment }, { status: 201 });
  } catch (error) {
    console.error("appointment-confirm-offline-error", error);
    return NextResponse.json({ error: "Unable to confirm this appointment" }, { status: 500 });
  }
}
