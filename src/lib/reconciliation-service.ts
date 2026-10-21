// src/lib/reconciliation-service.ts

import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  fetchRazorpayRefund,
  createRazorpayRefund,
  fetchRazorpayOrderPayments,
  fetchRazorpayOrderByReceipt,
} from "@/lib/razorpay";
import { verifyAndFinalizeCheckout } from "@/lib/checkout-service";
import { claimAndExecuteRefund } from "@/lib/payment-booking-service";
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

const LEASE_DURATION_MS = 30_000; // 30-second processing lease

/**
 * Recovers checkouts where provider order was created but its reference was lost
 * (Gap A: checkout is in PENDING_ORDER or UNRESOLVED with razorpayOrderId == null).
 */
export async function reconcileUnresolvedOrders(batchSize = 20): Promise<{ reconciled: number; errors: string[] }> {
  let reconciled = 0;
  const errors: string[] = [];
  const now = new Date();
  const workerId = `worker_unres_${process.pid}_${randomUUID().slice(0, 8)}`;

  const candidates = await prisma.checkout.findMany({
    where: {
      status: { in: ["PENDING_ORDER", "UNRESOLVED"] },
      razorpayOrderId: null,
      providerReference: { not: null },
      updatedAt: { lt: new Date(now.getTime() - 10_000) },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  for (const checkout of candidates) {
    if (!checkout.providerReference) continue;

    // Atomically claim processing lease
    const claimed = await prisma.checkout.updateMany({
      where: {
        id: checkout.id,
        status: { in: ["PENDING_ORDER", "UNRESOLVED"] },
        razorpayOrderId: null,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        processingStartedAt: new Date(),
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    if (claimed.count === 0) continue;

    try {
      const recoveredOrder = await fetchRazorpayOrderByReceipt(checkout.providerReference);

      if (recoveredOrder) {
        // Authoritative validation of ownership, amount, and currency before linking
        const notes = (recoveredOrder.notes || {}) as Record<string, string>;
        const matchesCheckout = !notes.checkoutId || notes.checkoutId === checkout.id;
        const matchesUser = !notes.userId || notes.userId === checkout.userId;
        const matchesDoctor = !notes.doctorId || notes.doctorId === checkout.doctorId;
        const matchesSlot = !notes.slotId || notes.slotId === checkout.slotId;
        const matchesAmount = Number(recoveredOrder.amount) === checkout.amount;
        const matchesCurrency = recoveredOrder.currency === checkout.currency;

        if (!matchesCheckout || !matchesUser || !matchesDoctor || !matchesSlot || !matchesAmount || !matchesCurrency) {
          await prisma.checkout.updateMany({
            where: { id: checkout.id, leaseOwner: workerId },
            data: {
              status: "MANUAL_REVIEW",
              lastError: "Recovered provider order failed invariant validation: ownership, amount, or currency mismatch",
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
          errors.push(`Checkout ${checkout.id}: Recovered order ${recoveredOrder.id} failed validation; transitioned to MANUAL_REVIEW`);
          continue;
        }

        // Locate or create Payment record for the recovered order
        let payment = await prisma.payment.findUnique({
          where: { razorpayOrderId: recoveredOrder.id },
        });

        if (!payment) {
          payment = await prisma.payment.create({
            data: {
              userId: checkout.userId,
              doctorId: checkout.doctorId,
              slotId: checkout.slotId,
              holdToken: checkout.holdToken,
              amount: checkout.amount,
              currency: checkout.currency,
              status: "CREATED",
              razorpayOrderId: recoveredOrder.id,
              idempotencyKey: `pay_${checkout.idempotencyKey}`,
            },
          });
        }

        const isExpired = new Date() >= checkout.expiresAt;
        const targetStatus = isExpired ? "EXPIRED" : "READY_FOR_PAYMENT";

        // Commit linkage guarded by leaseOwner
        const committed = await prisma.checkout.updateMany({
          where: {
            id: checkout.id,
            leaseOwner: workerId,
            status: { not: "CONFIRMED" },
          },
          data: {
            razorpayOrderId: recoveredOrder.id,
            paymentId: payment.id,
            status: targetStatus,
            lastError: null,
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
          },
        });

        if (committed.count > 0) {
          reconciled++;
        }
      } else {
        // Order not found on provider
        const isExpired = new Date() >= checkout.expiresAt;
        const newAttempts = checkout.attempts + 1;

        if (isExpired && newAttempts >= 3) {
          // Bounded retries exhausted and reservation expired: transition to EXPIRED
          await prisma.checkout.updateMany({
            where: { id: checkout.id, leaseOwner: workerId, status: { not: "CONFIRMED" } },
            data: {
              status: "EXPIRED",
              lastError: "Provider order not found after retries; reservation expired",
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
        } else if (newAttempts >= 5) {
          // Retain actionable manual review state
          await prisma.checkout.updateMany({
            where: { id: checkout.id, leaseOwner: workerId, status: { not: "CONFIRMED" } },
            data: {
              status: "MANUAL_REVIEW",
              lastError: "Provider order not located after 5 attempts; requires manual review",
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
        } else {
          // Retry with exponential backoff
          const nextAttemptAt = new Date(Date.now() + Math.min(15_000 * Math.pow(2, newAttempts), 300_000));
          await prisma.checkout.updateMany({
            where: { id: checkout.id, leaseOwner: workerId },
            data: {
              nextAttemptAt,
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
        }
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Unresolved order checkout ${checkout.id}: ${msg}`);
      await prisma.checkout.updateMany({
        where: { id: checkout.id, leaseOwner: workerId },
        data: {
          lastError: msg,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + 30_000),
        },
      }).catch(() => undefined);
    }
  }

  return { reconciled, errors };
}

/**
 * Reconciles checkouts with pending/uncertain orders or captured payments.
 * Covers both active checkouts and EXPIRED checkouts whose money outcome remains unresolved (Gap B),
 * as well as historical pending Payment records.
 */
export async function reconcileCapturedCheckouts(batchSize = 20): Promise<{ reconciled: number; errors: string[] }> {
  let reconciled = 0;
  const errors: string[] = [];
  const now = new Date();
  const workerId = `worker_capt_${process.pid}_${randomUUID().slice(0, 8)}`;

  // 1. Recover checkouts (READY_FOR_PAYMENT, UNRESOLVED, PENDING_ORDER, or EXPIRED unconfirmed checkouts)
  const candidates = await prisma.checkout.findMany({
    where: {
      status: { in: ["READY_FOR_PAYMENT", "UNRESOLVED", "PENDING_ORDER", "EXPIRED"] },
      razorpayOrderId: { not: null },
      appointmentId: null,
      updatedAt: { lt: new Date(now.getTime() - 10_000) },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    include: { payment: { include: { refunds: true } } },
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  for (const checkout of candidates) {
    if (!checkout.razorpayOrderId) continue;

    // Skip if already refunded or in progress
    if (checkout.payment?.status === "REFUNDED") continue;
    const hasProcessedRefund = checkout.payment?.refunds?.some((r) => r.status === "PROCESSED");
    if (hasProcessedRefund) continue;

    // Atomically claim lease
    const claimed = await prisma.checkout.updateMany({
      where: {
        id: checkout.id,
        appointmentId: null,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        processingStartedAt: new Date(),
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    if (claimed.count === 0) continue;

    try {
      const payments = await fetchRazorpayOrderPayments(checkout.razorpayOrderId);
      const captured = payments.find((p) => p.status === "captured" || p.captured);

      if (captured) {
        const isExpired = checkout.status === "EXPIRED" || new Date() >= checkout.expiresAt;

        if (isExpired) {
          // Late captured payment discovered after expiry:
          // Strict reservation expiry: late captured payments must not reclaim expired slots!
          // Atomically record captured payment evidence
          if (checkout.paymentId) {
            await prisma.payment.updateMany({
              where: { id: checkout.paymentId, status: { not: "SUCCESS" } },
              data: {
                razorpayPaymentId: captured.id,
                capturedAt: new Date(captured.created_at * 1000 || Date.now()),
              },
            });
          }

          // Trigger idempotent refund compensation
          const refundRes = await claimAndExecuteRefund({
            paymentId: checkout.paymentId || checkout.id,
            providerPaymentId: captured.id,
            reason: "Reservation expired before payment discovery; late slot reclaim prohibited",
            initiatedBy: "SYSTEM",
            idempotencyKey: `refund_checkout_${checkout.id}`,
            amount: checkout.amount,
          });

          if (refundRes.success) {
            reconciled++;
          } else {
            errors.push(`Checkout ${checkout.id}: Refund compensation status ${refundRes.status}`);
          }
        } else {
          // Checkout is still within valid reservation window
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
      }

      // Release lease upon completion
      await prisma.checkout.updateMany({
        where: { id: checkout.id, leaseOwner: workerId },
        data: {
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Checkout ${checkout.id}: ${msg}`);
      await prisma.checkout.updateMany({
        where: { id: checkout.id, leaseOwner: workerId },
        data: {
          lastError: msg,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + 30_000),
        },
      }).catch(() => undefined);
    }
  }

  // 2. Pre-migration & historical pending Payment records reconciliation
  const pendingPayments = await prisma.payment.findMany({
    where: {
      status: { in: ["CREATED", "PENDING"] },
      razorpayOrderId: { not: "" },
      appointment: null,
      createdAt: { lt: new Date(now.getTime() - 60_000) },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
    },
    include: { refunds: true },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  for (const payment of pendingPayments) {
    if (payment.status === "REFUNDED") continue;
    const claimed = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: ["CREATED", "PENDING"] },
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) continue;

    try {
      const payments = await fetchRazorpayOrderPayments(payment.razorpayOrderId);
      const captured = payments.find((p) => p.status === "captured" || p.captured);

      if (captured) {
        // Authoritatively record captured payment ID
        await prisma.payment.updateMany({
          where: { id: payment.id, leaseOwner: workerId },
          data: {
            razorpayPaymentId: captured.id,
            capturedAt: new Date(captured.created_at * 1000 || Date.now()),
          },
        });

        // Historical unfulfilled payment: trigger refund compensation
        const refundRes = await claimAndExecuteRefund({
          paymentId: payment.id,
          providerPaymentId: captured.id,
          reason: "Historical unfulfilled payment discovered during reconciliation",
          initiatedBy: "SYSTEM",
          idempotencyKey: `auto_refund_hist_${payment.id}`,
          amount: payment.amount,
        });

        if (refundRes.success) {
          reconciled++;
        }
      }

      await prisma.payment.updateMany({
        where: { id: payment.id, leaseOwner: workerId },
        data: { leaseOwner: null, leaseExpiresAt: null },
      });
    } catch (e: any) {
      await prisma.payment.updateMany({
        where: { id: payment.id, leaseOwner: workerId },
        data: { leaseOwner: null, leaseExpiresAt: null },
      }).catch(() => undefined);
    }
  }

  return { reconciled, errors };
}

/**
 * Reconciles pending refunds with Razorpay provider status and idempotency guarantees.
 * Uses atomic leases to prevent competing refund executions.
 */
export async function reconcilePendingRefunds(batchSize = 20): Promise<{ reconciled: number; errors: string[] }> {
  let reconciled = 0;
  const errors: string[] = [];
  const now = new Date();
  const workerId = `worker_rfnd_${process.pid}_${randomUUID().slice(0, 8)}`;

  const pendingRefunds = await prisma.refund.findMany({
    where: {
      status: { in: ["PENDING", "PROCESSING"] },
      updatedAt: { lt: new Date(now.getTime() - 30_000) },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    include: { payment: true },
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  for (const refund of pendingRefunds) {
    let payment = refund.payment;
    if (!payment) continue;

    // Atomically claim lease
    const claimed = await prisma.refund.updateMany({
      where: {
        id: refund.id,
        status: { in: ["PENDING", "PROCESSING"] },
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        attempts: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });

    if (claimed.count === 0) continue;

    try {
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

      if (!payment.razorpayPaymentId) {
        await prisma.refund.updateMany({
          where: { id: refund.id, leaseOwner: workerId },
          data: {
            leaseOwner: null,
            leaseExpiresAt: null,
            failureReason: "Missing provider payment ID for refund reconciliation",
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        });
        continue;
      }

      if (refund.razorpayRefundId) {
        const providerRefund = await fetchRazorpayRefund(
          payment.razorpayPaymentId,
          refund.razorpayRefundId
        );

        if (providerRefund.status === "processed") {
          await prisma.$transaction([
            prisma.refund.updateMany({
              where: { id: refund.id, leaseOwner: workerId },
              data: {
                status: "PROCESSED",
                processedAt: new Date(),
                failureReason: null,
                leaseOwner: null,
                leaseExpiresAt: null,
              },
            }),
            prisma.payment.updateMany({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            }),
          ]);
          reconciled++;
        } else if (providerRefund.status === "failed") {
          await prisma.refund.updateMany({
            where: { id: refund.id, leaseOwner: workerId },
            data: {
              status: "FAILED",
              failureReason: "Provider refund marked failed",
              leaseOwner: null,
              leaseExpiresAt: null,
            },
          });
        } else {
          // Still pending with provider
          await prisma.refund.updateMany({
            where: { id: refund.id, leaseOwner: workerId },
            data: {
              leaseOwner: null,
              leaseExpiresAt: null,
              nextAttemptAt: new Date(Date.now() + 60_000),
            },
          });
        }
      } else {
        // Execute refund with documented provider idempotency header
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
            prisma.refund.updateMany({
              where: { id: refund.id, leaseOwner: workerId },
              data: {
                status: "PROCESSED",
                razorpayRefundId: providerRefund.id,
                processedAt: new Date(),
                failureReason: null,
                leaseOwner: null,
                leaseExpiresAt: null,
              },
            }),
            prisma.payment.updateMany({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            }),
          ]);
          reconciled++;
        } else {
          await prisma.refund.updateMany({
            where: { id: refund.id, leaseOwner: workerId },
            data: {
              razorpayRefundId: providerRefund.id,
              leaseOwner: null,
              leaseExpiresAt: null,
              nextAttemptAt: new Date(Date.now() + 60_000),
            },
          });
        }
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Refund ${refund.id}: ${msg}`);
      await prisma.refund.updateMany({
        where: { id: refund.id, leaseOwner: workerId },
        data: {
          failureReason: msg,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      }).catch(() => undefined);
    }
  }

  return { reconciled, errors };
}

/**
 * Replays retryable Webhook events (FAILED, stale RECEIVED, or expired PROCESSING leases).
 * Uses atomic leases to prevent competing webhook executions.
 */
export async function replayRetryableWebhookEvents(batchSize = 25): Promise<{ replayed: number; errors: string[] }> {
  let replayed = 0;
  const errors: string[] = [];
  const now = new Date();
  const workerId = `worker_wh_${process.pid}_${randomUUID().slice(0, 8)}`;

  const candidates = await prisma.webhookEvent.findMany({
    where: {
      OR: [
        { status: "FAILED" },
        { status: "RECEIVED", receivedAt: { lt: new Date(now.getTime() - 30_000) } },
        { status: "PROCESSING", leaseExpiresAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
          ],
        },
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
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        processingStartedAt: new Date(),
        attempts: { increment: 1 },
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
        await prisma.webhookEvent.updateMany({
          where: { id: event.id, leaseOwner: workerId },
          data: {
            status: "PROCESSED",
            processedAt: new Date(),
            processingError: null,
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        replayed++;
      } else if (outcome.unlinked) {
        await prisma.webhookEvent.updateMany({
          where: { id: event.id, leaseOwner: workerId },
          data: {
            status: "RECEIVED",
            processingError: outcome.error || "Awaiting order linkage",
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(Date.now() + 30_000),
          },
        });
      } else {
        await prisma.webhookEvent.updateMany({
          where: { id: event.id, leaseOwner: workerId },
          data: {
            status: "FAILED",
            processingError: outcome.error || "Replay processing failed",
            leaseOwner: null,
            leaseExpiresAt: null,
            nextAttemptAt: new Date(Date.now() + 60_000),
          },
        });
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Webhook event ${event.id}: ${msg}`);
      await prisma.webhookEvent.updateMany({
        where: { id: event.id, leaseOwner: workerId },
        data: {
          status: "FAILED",
          processingError: msg,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      }).catch(() => undefined);
    }
  }

  return { replayed, errors };
}

/**
 * Reconciles pending notifications in the Outbox with atomic leases.
 * Prevents concurrent direct/scheduled dispatch collision and starvation.
 */
export async function reconcileNotificationOutbox(batchSize = 50): Promise<{ delivered: number; failed: number; errors: string[] }> {
  let delivered = 0;
  let failed = 0;
  const errors: string[] = [];
  const now = new Date();
  const workerId = `worker_outbox_${process.pid}_${randomUUID().slice(0, 8)}`;

  const pendingOutbox = await prisma.notificationOutbox.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: 5 },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
      AND: [
        {
          OR: [
            { nextAttemptAt: null },
            { nextAttemptAt: { lte: now } },
          ],
        },
      ],
    },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });

  for (const item of pendingOutbox) {
    const claimed = await prisma.notificationOutbox.updateMany({
      where: {
        id: item.id,
        status: item.status,
        OR: [
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
        ],
      },
      data: {
        status: "PROCESSING",
        leaseOwner: workerId,
        leaseExpiresAt: new Date(Date.now() + LEASE_DURATION_MS),
        processingStartedAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    if (claimed.count === 0) continue;

    try {
      const payload = item.payload as Record<string, unknown>;
      const endpoint =
        item.channel === "SOCKET_APPOINTMENT_REQUEST" || (payload?.appointment && payload?.doctorUserId)
          ? "/api/notifications/new-appointment"
          : "/api/notifications/broadcast";

      const res = await publishToSocketServer(endpoint, payload);
      if (res !== null) {
        await prisma.notificationOutbox.updateMany({
          where: { id: item.id, leaseOwner: workerId },
          data: {
            status: "DELIVERED",
            deliveredAt: new Date(),
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        delivered++;
      } else {
        const newAttempts = item.attempts + 1;
        const nextAttemptAt = new Date(Date.now() + Math.min(30_000 * Math.pow(2, newAttempts), 300_000));
        await prisma.notificationOutbox.updateMany({
          where: { id: item.id, leaseOwner: workerId },
          data: {
            attempts: newAttempts,
            lastAttemptAt: new Date(),
            nextAttemptAt,
            status: newAttempts >= 5 ? "FAILED" : "PENDING",
            lastError: "Socket server unreachable or returned non-ok status",
            leaseOwner: null,
            leaseExpiresAt: null,
          },
        });
        if (newAttempts >= 5) failed++;
      }
    } catch (err: any) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Outbox item ${item.id}: ${msg}`);
      await prisma.notificationOutbox.updateMany({
        where: { id: item.id, leaseOwner: workerId },
        data: {
          lastError: msg,
          leaseOwner: null,
          leaseExpiresAt: null,
          nextAttemptAt: new Date(Date.now() + 60_000),
        },
      }).catch(() => undefined);
    }
  }

  return { delivered, failed, errors };
}
