import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { verifyAndTransitionPayment } from "@/lib/payment-booking-service";

export async function POST(req: NextRequest) {
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch (readErr) {
    return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
  }

  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing x-razorpay-signature header" }, { status: 400 });
  }

  const isValid = verifyWebhookSignature({
    rawBody,
    signature,
  });

  if (!isValid) {
    return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch (parseErr) {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = typeof event.event === "string" ? event.event : "unknown";
  const providerEventId =
    req.headers.get("x-razorpay-event-id") ||
    event.id ||
    event.event_id ||
    `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 1. Store event durably with idempotency deduplication
  let storedEvent: any;
  try {
    storedEvent = await prisma.webhookEvent.create({
      data: {
        providerEventId,
        eventType,
        payload: event,
        status: "RECEIVED",
      },
    });
  } catch (dbErr: any) {
    if (dbErr?.code === "P2002") {
      // Event already received / processed (duplicate delivery)
      return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
    }
    console.error("[Webhook] Failed to store webhook event:", dbErr);
    return NextResponse.json({ error: "Database error persisting event" }, { status: 500 });
  }

  // 2. Process relevant events asynchronously or synchronously before returning 200
  try {
    await prisma.webhookEvent.update({
      where: { id: storedEvent.id },
      data: { status: "PROCESSING" },
    });

    const paymentEntity = event.payload?.payment?.entity;
    const orderEntity = event.payload?.order?.entity;
    const refundEntity = event.payload?.refund?.entity;

    if (eventType === "payment.captured") {
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;

      if (orderId && paymentId) {
        // Link to internal payment if exists
        const paymentRecord = await prisma.payment.findUnique({
          where: { razorpayOrderId: orderId },
        });

        if (paymentRecord) {
          await prisma.webhookEvent.update({
            where: { id: storedEvent.id },
            data: { paymentId: paymentRecord.id },
          });

          await verifyAndTransitionPayment({
            orderId,
            paymentId,
            source: "WEBHOOK",
          });
        }
      }
    } else if (eventType === "order.paid") {
      const orderId = orderEntity?.id;
      const paymentId = paymentEntity?.id;

      if (orderId && paymentId) {
        const paymentRecord = await prisma.payment.findUnique({
          where: { razorpayOrderId: orderId },
        });

        if (paymentRecord) {
          await prisma.webhookEvent.update({
            where: { id: storedEvent.id },
            data: { paymentId: paymentRecord.id },
          });

          await verifyAndTransitionPayment({
            orderId,
            paymentId,
            source: "WEBHOOK",
          });
        }
      }
    } else if (eventType === "payment.failed") {
      const orderId = paymentEntity?.order_id;
      const paymentId = paymentEntity?.id;

      if (orderId) {
        const paymentRecord = await prisma.payment.findUnique({
          where: { razorpayOrderId: orderId },
        });

        if (paymentRecord && paymentRecord.status !== "SUCCESS" && paymentRecord.status !== "REFUNDED") {
          await prisma.payment.update({
            where: { id: paymentRecord.id },
            data: { status: "FAILED", razorpayPaymentId: paymentId || undefined },
          });
          await prisma.webhookEvent.update({
            where: { id: storedEvent.id },
            data: { paymentId: paymentRecord.id },
          });
        }
      }
    } else if (eventType === "refund.processed") {
      const refundId = refundEntity?.id;
      const paymentId = refundEntity?.payment_id;

      if (paymentId) {
        const paymentRecord = await prisma.payment.findFirst({
          where: { razorpayPaymentId: paymentId },
        });

        if (paymentRecord) {
          await prisma.$transaction([
            prisma.payment.update({
              where: { id: paymentRecord.id },
              data: { status: "REFUNDED" },
            }),
            prisma.refund.updateMany({
              where: {
                paymentId: paymentRecord.id,
                OR: [{ razorpayRefundId: refundId }, { razorpayRefundId: null }],
              },
              data: {
                status: "PROCESSED",
                razorpayRefundId: refundId || undefined,
                processedAt: new Date(),
                failureReason: null,
              },
            }),
          ]);

          await prisma.webhookEvent.update({
            where: { id: storedEvent.id },
            data: { paymentId: paymentRecord.id },
          });
        }
      }
    } else if (eventType === "refund.failed") {
      const refundId = refundEntity?.id;
      const paymentId = refundEntity?.payment_id;

      if (paymentId) {
        const paymentRecord = await prisma.payment.findFirst({
          where: { razorpayPaymentId: paymentId },
        });

        if (paymentRecord) {
          await prisma.refund.updateMany({
            where: {
              paymentId: paymentRecord.id,
              OR: [{ razorpayRefundId: refundId }, { razorpayRefundId: null }],
            },
            data: {
              status: "FAILED",
              failureReason: refundEntity?.error_description || "Provider refund failed",
            },
          });
        }
      }
    }

    // Mark event as successfully processed
    await prisma.webhookEvent.update({
      where: { id: storedEvent.id },
      data: {
        status: "PROCESSED",
        processedAt: new Date(),
        processingError: null,
      },
    });

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (processErr: any) {
    const errorMsg = processErr instanceof Error ? processErr.message : String(processErr);
    console.error(`[Webhook] Error processing event ${providerEventId}:`, errorMsg);

    // Keep event recoverable: mark as FAILED with error message
    await prisma.webhookEvent.update({
      where: { id: storedEvent.id },
      data: {
        status: "FAILED",
        processingError: errorMsg,
      },
    }).catch(() => undefined);

    // Return 200 so provider doesn't spam retries if the event was durably persisted,
    // or return 500 if transient retry is desired. Razorpay retries on non-2xx.
    return NextResponse.json({ received: true, error: errorMsg }, { status: 200 });
  }
}
