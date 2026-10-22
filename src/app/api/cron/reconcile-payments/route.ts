import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { acquireSlotMutex, releaseSlotMutex } from "@/lib/slot-mutex";
import { expireStaleCheckouts } from "@/lib/checkout-service";
import {
  reconcileUnresolvedOrders,
  reconcilePendingRefunds,
  reconcileCapturedCheckouts,
  replayRetryableWebhookEvents,
  reconcileNotificationOutbox,
} from "@/lib/reconciliation-service";

const TIME_BUDGET_MS = 24_000; // 24s execution limit for serverless environment

export async function POST(req: NextRequest) {
  const startTime = Date.now();
  const isBudgetExceeded = () => (Date.now() - startTime) >= TIME_BUDGET_MS;
  const skippedPhases: string[] = [];

  // 1. Fail closed when cron credentials are absent or invalid
  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "Cron secret is not configured in environment" },
      { status: 500 }
    );
  }

  const authHeader = req.headers.get("authorization");
  const isAuthorized =
    authHeader === `Bearer ${cronSecret}` ||
    req.headers.get("x-cron-secret") === cronSecret;

  if (!isAuthorized) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // 2. Coordinate overlapping cron executions via distributed mutex
  const lockKey = "cron:reconcile-payments:lock";
  const mutex = await acquireSlotMutex(lockKey, 120);
  if (!mutex.acquired) {
    return NextResponse.json(
      { ok: false, skipped: true, message: "Another reconciliation job is currently active" },
      { status: 409 }
    );
  }

  const results = {
    reconciledUnresolved: 0,
    reconciledRefunds: 0,
    reconciledPayments: 0,
    reconciledCheckouts: 0,
    replayedWebhooks: 0,
    outboxDelivered: 0,
    outboxFailed: 0,
    errors: [] as string[],
  };

  try {
    // 3. Recover unresolved orders with lost references (Gap A)
    if (!isBudgetExceeded()) {
      const unresResult = await reconcileUnresolvedOrders(20);
      results.reconciledUnresolved += unresResult.reconciled;
      results.errors.push(...unresResult.errors);
    } else {
      skippedPhases.push("reconcileUnresolvedOrders");
    }

    // 4. Reconcile PENDING refunds (older than 30s, bounded batch of 20)
    if (!isBudgetExceeded()) {
      const refundRes = await reconcilePendingRefunds(20);
      results.reconciledRefunds += refundRes.reconciled;
      results.errors.push(...refundRes.errors);
    } else {
      skippedPhases.push("reconcilePendingRefunds");
    }

    // 5. Reconcile captured checkouts, pending orders, and expired checkouts (Gap B, bounded batch of 20)
    if (!isBudgetExceeded()) {
      const checkoutRes = await reconcileCapturedCheckouts(20);
      results.reconciledPayments += checkoutRes.reconciled;
      results.errors.push(...checkoutRes.errors);
    } else {
      skippedPhases.push("reconcileCapturedCheckouts");
    }

    // 6. Replay retryable Webhook events (FAILED, stale RECEIVED, or expired leases, bounded batch of 25)
    if (!isBudgetExceeded()) {
      const webhookRes = await replayRetryableWebhookEvents(25);
      results.replayedWebhooks += webhookRes.replayed;
      results.errors.push(...webhookRes.errors);
    } else {
      skippedPhases.push("replayRetryableWebhookEvents");
    }

    // 7. Reconcile Notification Outbox (bounded batch of 15 with execution deadline)
    if (!isBudgetExceeded()) {
      const remainingMs = Math.max(0, TIME_BUDGET_MS - (Date.now() - startTime));
      const outboxRes = await reconcileNotificationOutbox(15, Date.now() + remainingMs);
      results.outboxDelivered += outboxRes.delivered;
      results.outboxFailed += outboxRes.failed;
      results.errors.push(...outboxRes.errors);
    } else {
      skippedPhases.push("reconcileNotificationOutbox");
    }

    // 8. Expire stale checkouts and reservations
    if (!isBudgetExceeded()) {
      try {
        const expiredCount = await expireStaleCheckouts();
        results.reconciledCheckouts = expiredCount;
      } catch (err: any) {
        results.errors.push(`Stale checkout cleanup error: ${err?.message}`);
      }
    } else {
      skippedPhases.push("expireStaleCheckouts");
    }

    // 9. Backlog queue depth and lag metrics
    const [
      pendingCheckouts,
      pendingRefunds,
      pendingWebhooks,
      pendingOutbox,
      oldestCheckout,
    ] = await Promise.all([
      prisma.checkout.count({
        where: { status: { in: ["PENDING_ORDER", "READY_FOR_PAYMENT", "UNRESOLVED"] } },
      }).catch(() => 0),
      prisma.refund.count({
        where: { status: { in: ["PENDING", "PROCESSING"] } },
      }).catch(() => 0),
      prisma.webhookEvent.count({
        where: { status: { in: ["RECEIVED", "PROCESSING", "FAILED"] } },
      }).catch(() => 0),
      prisma.notificationOutbox.count({
        where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } },
      }).catch(() => 0),
      prisma.checkout.findFirst({
        where: { status: { in: ["PENDING_ORDER", "READY_FOR_PAYMENT", "UNRESOLVED"] } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true },
      }).catch(() => null),
    ]);

    const oldestPendingCheckoutAgeSeconds = oldestCheckout?.createdAt
      ? Math.max(0, Math.floor((Date.now() - oldestCheckout.createdAt.getTime()) / 1000))
      : 0;

    const executionDurationMs = Date.now() - startTime;
    return NextResponse.json(
      {
        ok: results.errors.length === 0,
        skipped: false,
        budgetExceeded: skippedPhases.length > 0,
        skippedPhases,
        results,
        backlog: {
          pendingCheckouts,
          pendingRefunds,
          pendingWebhooks,
          pendingOutbox,
          oldestPendingCheckoutAgeSeconds,
        },
        executionDurationMs,
      },
      { status: 200 }
    );
  } finally {
    await releaseSlotMutex(lockKey, mutex.token).catch(() => undefined);
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
