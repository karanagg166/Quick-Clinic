import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchRazorpayPayment, fetchRazorpayRefund, createRazorpayRefund } from "@/lib/razorpay";
import { verifyAndTransitionPayment } from "@/lib/payment-booking-service";
import { publishToSocketServer } from "@/lib/socket-publisher";

export async function POST(req: NextRequest) {
  // Protect cron endpoint: verify CRON_SECRET or ADMIN role or INTERNAL_API_SECRET
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET;
  const isAuthorized =
    !cronSecret ||
    authHeader === `Bearer ${cronSecret}` ||
    req.headers.get("x-cron-secret") === cronSecret;

  if (!isAuthorized && process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const results = {
    reconciledRefunds: 0,
    reconciledPayments: 0,
    outboxDelivered: 0,
    outboxFailed: 0,
    errors: [] as string[],
  };

  // 1. Reconcile PENDING refunds
  try {
    const pendingRefunds = await prisma.refund.findMany({
      where: {
        status: "PENDING",
        updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) }, // Older than 2 mins
      },
      include: {
        payment: true,
      },
      take: 20,
    });

    for (const refund of pendingRefunds) {
      try {
        const payment = refund.payment;
        if (!payment || !payment.razorpayPaymentId) {
          continue;
        }

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
            results.reconciledRefunds++;
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
          // Timeout occurred before provider refund ID was recorded.
          // Retry using the exact same idempotencyKey!
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
            results.reconciledRefunds++;
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
        results.errors.push(`Refund ${refund.id}: ${err?.message}`);
      }
    }
  } catch (err: any) {
    results.errors.push(`Refund reconciliation query error: ${err?.message}`);
  }

  // 2. Reconcile Notification Outbox
  try {
    const pendingOutbox = await prisma.notificationOutbox.findMany({
      where: {
        status: "PENDING",
        attempts: { lt: 5 },
      },
      take: 50,
    });

    for (const item of pendingOutbox) {
      try {
        const payload = item.payload as Record<string, unknown>;
        let path = "/api/notifications/broadcast";
        if (payload?.appointment && payload?.doctorUserId) {
          path = "/api/appointments/request";
        }

        const res = await publishToSocketServer(path, payload);
        if (res !== null) {
          await prisma.notificationOutbox.update({
            where: { id: item.id },
            data: {
              status: "DELIVERED",
              deliveredAt: new Date(),
            },
          });
          results.outboxDelivered++;
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
          if (newAttempts >= 5) results.outboxFailed++;
        }
      } catch (err: any) {
        results.errors.push(`Outbox item ${item.id}: ${err?.message}`);
      }
    }
  } catch (err: any) {
    results.errors.push(`Outbox reconciliation query error: ${err?.message}`);
  }

  return NextResponse.json({ ok: true, results }, { status: 200 });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
