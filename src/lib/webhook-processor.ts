// src/lib/webhook-processor.ts

import { prisma } from "@/lib/prisma";
import { verifyAndTransitionPayment } from "@/lib/payment-booking-service";
import { verifyAndFinalizeCheckout } from "@/lib/checkout-service";

export interface WebhookProcessOutcome {
  success: boolean;
  unlinked?: boolean;
  terminalRefund?: boolean;
  error?: string;
}

/**
 * Authoritatively processes a single Webhook event payload.
 * Shared between real-time webhook POST endpoint and cron reconciliation replay.
 */
export async function processSingleWebhookEvent(eventRecord: {
  id: string;
  eventType: string;
  payload: any;
}): Promise<WebhookProcessOutcome> {
  const { id: eventId, eventType, payload } = eventRecord;
  const paymentEntity = payload?.payload?.payment?.entity || payload?.payment?.entity;
  const orderEntity = payload?.payload?.order?.entity || payload?.order?.entity;
  const refundEntity = payload?.payload?.refund?.entity || payload?.refund?.entity;

  if (eventType === "payment.captured" || eventType === "order.paid") {
    const orderId = paymentEntity?.order_id || orderEntity?.id;
    const paymentId = paymentEntity?.id;

    if (!orderId) {
      return { success: false, error: "Missing order_id in event payload" };
    }

    const [paymentRecord, checkoutRecord] = await Promise.all([
      prisma.payment.findUnique({ where: { razorpayOrderId: orderId } }),
      prisma.checkout.findUnique({ where: { razorpayOrderId: orderId } }),
    ]);

    if (!paymentRecord && !checkoutRecord) {
      // Early arrival: checkout or payment record does not exist yet.
      // Keep event recoverable in RECEIVED status; reconciliation will replay it after linkage.
      return { success: false, unlinked: true, error: `No checkout or payment linked yet for order ${orderId}` };
    }

    if (paymentRecord && paymentId) {
      await prisma.webhookEvent.update({
        where: { id: eventId },
        data: { paymentId: paymentRecord.id },
      }).catch(() => undefined);
    }

    if (checkoutRecord) {
      const finalResult = await verifyAndFinalizeCheckout({
        userId: checkoutRecord.userId,
        checkoutId: checkoutRecord.id,
        orderId,
        paymentId: paymentId || undefined,
        source: "WEBHOOK",
      });

      if (finalResult.success) {
        return { success: true };
      }
      if (
        finalResult.status === "REFUNDED" ||
        finalResult.status === "REFUND_PENDING" ||
        finalResult.status === "SLOT_UNAVAILABLE_REFUNDED"
      ) {
        return { success: true, terminalRefund: true };
      }
      return {
        success: false,
        error: finalResult.error || `Finalization returned status ${finalResult.status} with code ${finalResult.statusCode}`,
      };
    } else if (paymentRecord) {
      const finalResult = await verifyAndTransitionPayment({
        orderId,
        paymentId: paymentId || undefined,
        source: "WEBHOOK",
      });

      if (finalResult.success) {
        return { success: true };
      }
      if (finalResult.status === "REFUNDED" || finalResult.status === "REFUND_PENDING") {
        return { success: true, terminalRefund: true };
      }
      return {
        success: false,
        error: finalResult.error || `Payment transition returned status ${finalResult.status}`,
      };
    }
  } else if (eventType === "payment.failed") {
    const orderId = paymentEntity?.order_id;
    const paymentId = paymentEntity?.id;

    if (orderId) {
      const [paymentRecord, checkoutRecord] = await Promise.all([
        prisma.payment.findUnique({ where: { razorpayOrderId: orderId } }),
        prisma.checkout.findUnique({ where: { razorpayOrderId: orderId } }),
      ]);

      if (
        paymentRecord &&
        paymentRecord.status !== "SUCCESS" &&
        paymentRecord.status !== "REFUNDED" &&
        paymentRecord.status !== "REFUND_PENDING"
      ) {
        await prisma.payment.updateMany({
          where: {
            id: paymentRecord.id,
            status: { notIn: ["SUCCESS", "REFUNDED", "REFUND_PENDING"] },
          },
          data: {
            status: "FAILED",
            razorpayPaymentId: paymentId || undefined,
          },
        }).catch(() => undefined);

        await prisma.webhookEvent.updateMany({
          where: { id: eventId },
          data: { paymentId: paymentRecord.id },
        }).catch(() => undefined);
      }

      // Do NOT terminally fail an entire checkout if it has not expired!
      // Razorpay allows customer to retry payment under the same order before hold expiry.
      if (checkoutRecord && checkoutRecord.status !== "CONFIRMED") {
        const isExpired = new Date() >= checkoutRecord.expiresAt;
        if (isExpired) {
          await prisma.checkout.updateMany({
            where: {
              id: checkoutRecord.id,
              status: { not: "CONFIRMED" },
            },
            data: { status: "EXPIRED" },
          }).catch(() => undefined);
        }
      }
    }
    return { success: true };
  } else if (eventType === "refund.processed") {
    const refundId = refundEntity?.id;
    const paymentId = refundEntity?.payment_id;

    if (paymentId) {
      let paymentRecord = await prisma.payment.findFirst({
        where: { razorpayPaymentId: paymentId },
      });

      if (!paymentRecord && refundEntity?.notes?.orderId) {
        paymentRecord = await prisma.payment.findUnique({
          where: { razorpayOrderId: refundEntity.notes.orderId },
        });
      }

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
          where: { id: eventId },
          data: { paymentId: paymentRecord.id },
        }).catch(() => undefined);
      }
    }
    return { success: true };
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
        }).catch(() => undefined);
      }
    }
    return { success: true };
  }

  // Any unrecognized or informational events are safely treated as handled
  return { success: true };
}
