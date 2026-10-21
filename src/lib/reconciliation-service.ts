// src/lib/reconciliation-service.ts

import { prisma } from "@/lib/prisma";
import { fetchRazorpayRefund, createRazorpayRefund, fetchRazorpayOrderPayments } from "@/lib/razorpay";
import { verifyAndFinalizeCheckout } from "@/lib/checkout-service";
import { publishToSocketServer } from "@/lib/socket-publisher";
import { processSingleWebhookEvent } from "@/lib/webhook-processor";

export interface ReconciliationSummary {
  reconciledRefunds: number;
  reconciledPayments: number;
  reconciledCheckouts: number;
  replayedWebhooks: number;
  outboxDelivered: number;
  outboxFailed: number;
  errors: string[];
}

/**
 * Reconciles checkouts with pending/uncertain orders or captured payments.
 */
export async function reconcileCapturedCheckouts(batchSize = 20): Promise<{ reconciled: number; errors: string[] }> {
  let reconciled = 0;
  const errors: string[] = [];

  const candidates = await prisma.checkout.findMany({
    where: {
      status: { in: ["READY_FOR_PAYMENT", "UNRESOLVED", "PENDING_ORDER"] },
      razorpayOrderId: { not: null },
      updatedAt: { lt: new Date(Date.now() - 60_000) },
    },
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  for (const checkout of candidates) {
    if (!checkout.razorpayOrderId) continue;
    try {
      const payments = await fetchRazorpayOrderPayments(checkout.razorpayOrderId);
      const captured = payments.find((p) => p.status === "captured" || p.captured);

      if (captured) {
        const result = await verifyAndFinalizeCheckout({
          userId: checkout.userId,
          checkoutId: checkout.id,
          orderId: checkout.razorpayOrderId,
          paymentId: captured.id,
          source: "RECONCILIATION",
        });

        if (
          result.success ||
          result.status === "REFUNDED" ||
          result.status === "REFUND_PENDING" ||
          result.status === "SLOT_UNAVAILABLE_REFUNDED"
        ) {
          reconciled++;
        } else if (result.error) {
          errors.push(`Checkout ${checkout.id}: ${result.error}`);
        }
      }
    } catch (err: any) {
      errors.push(`Checkout ${checkout.id}: ${err?.message}`);
    }
  }

  return { reconciled, errors };
}

/**
 * Reconciles pending refunds with Razorpay provider status and idempotency guarantees.
 */
export async function reconcilePendingRefunds(batchSize = 20): Promise<{ reconciled: number; errors: string[] }> {
  let reconciled = 0;
  const errors: string[] = [];

  const pendingRefunds = await prisma.refund.findMany({
    where: {
      status: "PENDING",
      updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) },
    },
    include: { payment: true },
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  for (const refund of pendingRefunds) {
    try {
      let payment = refund.payment;
      if (!payment) continue;

      // Reconcile captured payment ID if missing before executing refund
      if (!payment.razorpayPaymentId && payment.razorpayOrderId) {
        try {
          const payments = await fetchRazorpayOrderPayments(payment.razorpayOrderId);
          const captured = payments.find((p) => p.status === "captured" || p.captured);
          if (captured) {
            payment = await prisma.payment.update({
              where: { id: payment.id },
              data: { razorpayPaymentId: captured.id },
            });
          }
        } catch {
          // ignore error and proceed
        }
      }

      if (!payment.razorpayPaymentId) continue;

      if (refund.razorpayRefundId) {
        const providerRefund = await fetchRazorpayRefund(
          payment.razorpayPaymentId,
          refund.razorpayRefundId
        );

        if (providerRefund.status === "processed") {
          await prisma.$transaction([
            prisma.refund.update({
              where: { id: refund.id },
              data: {
                status: "PROCESSED",
                processedAt: new Date(),
                failureReason: null,
              },
            }),
            prisma.payment.update({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            }),
          ]);
          reconciled++;
        } else if (providerRefund.status === "failed") {
          await prisma.refund.update({
            where: { id: refund.id },
            data: {
              status: "FAILED",
              failureReason: "Provider refund marked failed",
            },
          });
        }
      } else {
        const providerRefund = await createRazorpayRefund({
          paymentId: payment.razorpayPaymentId,
          amount: refund.amount,
          idempotencyKey: refund.idempotencyKey,
          notes: {
            reason: refund.reason,
            reconciled: "true",
          },
        });

        if (providerRefund.status === "processed") {
          await prisma.$transaction([
            prisma.refund.update({
              where: { id: refund.id },
              data: {
                status: "PROCESSED",
                razorpayRefundId: providerRefund.id,
                processedAt: new Date(),
                failureReason: null,
              },
            }),
            prisma.payment.update({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            }),
          ]);
          reconciled++;
        } else {
          await prisma.refund.update({
            where: { id: refund.id },
            data: {
              razorpayRefundId: providerRefund.id,
              attempts: { increment: 1 },
              lastAttemptAt: new Date(),
            },
          });
        }
      }
    } catch (err: any) {
      errors.push(`Refund ${refund.id}: ${err?.message}`);
    }
  }

  return { reconciled, errors };
}

/**
 * Replays retryable Webhook events (FAILED, stale RECEIVED, or stale PROCESSING).
 */
export async function replayRetryableWebhookEvents(batchSize = 25): Promise<{ replayed: number; errors: string[] }> {
  let replayed = 0;
  const errors: string[] = [];

  const candidates = await prisma.webhookEvent.findMany({
    where: {
      OR: [
        { status: "FAILED" },
        { status: "RECEIVED", receivedAt: { lt: new Date(Date.now() - 60_000) } },
        { status: "PROCESSING", receivedAt: { lt: new Date(Date.now() - 5 * 60_000) } },
      ],
    },
    take: batchSize,
    orderBy: { receivedAt: "asc" },
  });

  for (const event of candidates) {
    const claimed = await prisma.webhookEvent.updateMany({
      where: {
        id: event.id,
        status: event.status,
      },
      data: {
        status: "PROCESSING",
        processingError: null,
      },
    });

    if (claimed.count === 0) continue;

    try {
      const outcome = await processSingleWebhookEvent({
        id: event.id,
        eventType: event.eventType,
        payload: event.payload,
      });

      if (outcome.success) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            processingError: null,
          },
        });
        replayed++;
      } else if (outcome.unlinked) {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: "RECEIVED",
            processingError: outcome.error || "Awaiting order linkage",
          },
        });
      } else {
        await prisma.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: "FAILED",
            processingError: outcome.error || "Replay processing failed",
          },
        });
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Webhook event ${event.id}: ${msg}`);
      await prisma.webhookEvent.update({
        where: { id: event.id },
        data: {
          status: "FAILED",
          processingError: msg,
        },
      }).catch(() => undefined);
    }
  }

  return { replayed, errors };
}

/**
 * Reconciles pending notifications in the Outbox.
 */
export async function reconcileNotificationOutbox(batchSize = 50): Promise<{ delivered: number; failed: number; errors: string[] }> {
  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];

  const pendingOutbox = await prisma.notificationOutbox.findMany({
    where: {
      status: "PENDING",
      attempts: { lt: 5 },
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  for (const item of pendingOutbox) {
    try {
      const payload = item.payload as Record<string, unknown>;
      const endpoint =
        item.channel === "SOCKET_APPOINTMENT_REQUEST" || (payload?.appointment && payload?.doctorUserId)
          ? "/api/notifications/new-appointment"
          : "/api/notifications/broadcast";

      const res = await publishToSocketServer(endpoint, payload);
      if (res !== null) {
        await prisma.notificationOutbox.update({
          where: { id: item.id },
          data: {
            status: "DELIVERED",
            deliveredAt: new Date(),
          },
        });
        delivered++;
      } else {
        const newAttempts = item.attempts + 1;
        await prisma.notificationOutbox.update({
          where: { id: item.id },
          data: {
            attempts: newAttempts,
            lastAttemptAt: new Date(),
            status: newAttempts >= 5 ? "FAILED" : "PENDING",
            lastError: "Socket server unreachable or returned non-ok status",
          },
        });
        if (newAttempts >= 5) failed++;
      }
    } catch (err: any) {
      errors.push(`Outbox item ${item.id}: ${err?.message}`);
    }
  }

  return { delivered, failed, errors };
}
