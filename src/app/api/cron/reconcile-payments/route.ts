import { NextResponse, type NextRequest } from "next/server";
import { acquireSlotMutex, releaseSlotMutex } from "@/lib/slot-mutex";
import { expireStaleCheckouts } from "@/lib/checkout-service";
import {
  reconcileUnresolvedOrders,
  reconcilePendingRefunds,
  reconcileCapturedCheckouts,
  replayRetryableWebhookEvents,
  reconcileNotificationOutbox,
} from "@/lib/reconciliation-service";

export async function POST(req: NextRequest) {
  const startTime = Date.now();

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
    const unresResult = await reconcileUnresolvedOrders(20);
    results.reconciledUnresolved += unresResult.reconciled;
    results.errors.push(...unresResult.errors);

    // 4. Reconcile PENDING refunds (older than 30s, bounded batch of 20)
    const refundRes = await reconcilePendingRefunds(20);
    results.reconciledRefunds += refundRes.reconciled;
    results.errors.push(...refundRes.errors);

    // 5. Reconcile captured checkouts, pending orders, and expired checkouts (Gap B, bounded batch of 20)
    const checkoutRes = await reconcileCapturedCheckouts(20);
    results.reconciledPayments += checkoutRes.reconciled;
    results.errors.push(...checkoutRes.errors);

    // 6. Replay retryable Webhook events (FAILED, stale RECEIVED, or expired leases, bounded batch of 25)
    const webhookRes = await replayRetryableWebhookEvents(25);
    results.replayedWebhooks += webhookRes.replayed;
    results.errors.push(...webhookRes.errors);

    // 7. Reconcile Notification Outbox (bounded batch of 50)
    const outboxRes = await reconcileNotificationOutbox(50);
    results.outboxDelivered += outboxRes.delivered;
    results.outboxFailed += outboxRes.failed;
    results.errors.push(...outboxRes.errors);

    // 8. Expire stale checkouts and reservations
    try {
      const expiredCount = await expireStaleCheckouts();
      results.reconciledCheckouts = expiredCount;
    } catch (err: any) {
      results.errors.push(`Stale checkout cleanup error: ${err?.message}`);
    }

    const executionDurationMs = Date.now() - startTime;
    return NextResponse.json(
      {
        ok: results.errors.length === 0,
        skipped: false,
        results,
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
