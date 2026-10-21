import { NextResponse, type NextRequest } from "next/server";
import { acquireSlotMutex, releaseSlotMutex } from "@/lib/slot-mutex";
import { expireStaleCheckouts } from "@/lib/checkout-service";
import {
  reconcilePendingRefunds,
  reconcileCapturedCheckouts,
  replayRetryableWebhookEvents,
  reconcileNotificationOutbox,
} from "@/lib/reconciliation-service";

export async function POST(req: NextRequest) {
  // 1. Fail closed when cron credentials are absent or invalid
  const cronSecret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "Cron secret is not configured" }, { status: 500 });
  }

  const authHeader = req.headers.get("authorization");
  const isAuthorized =
    authHeader === `Bearer ${cronSecret}` ||
    req.headers.get("x-cron-secret") === cronSecret;

  if (!isAuthorized) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    reconciledRefunds: 0,
    reconciledPayments: 0,
    reconciledCheckouts: 0,
    replayedWebhooks: 0,
    outboxDelivered: 0,
    outboxFailed: 0,
    errors: [] as string[],
  };

  try {
    // 3. Reconcile PENDING refunds (older than 2 mins, bounded batch of 20)
    const refundRes = await reconcilePendingRefunds(20);
    results.reconciledRefunds += refundRes.reconciled;
    results.errors.push(...refundRes.errors);

    // 4. Reconcile captured checkouts and pending orders (bounded batch of 20)
    const checkoutRes = await reconcileCapturedCheckouts(20);
    results.reconciledPayments += checkoutRes.reconciled;
    results.errors.push(...checkoutRes.errors);

    // 5. Replay retryable Webhook events (FAILED, stale RECEIVED, or stale PROCESSING, bounded batch of 25)
    const webhookRes = await replayRetryableWebhookEvents(25);
    results.replayedWebhooks += webhookRes.replayed;
    results.errors.push(...webhookRes.errors);

    // 6. Reconcile Notification Outbox (bounded batch of 50)
    const outboxRes = await reconcileNotificationOutbox(50);
    results.outboxDelivered += outboxRes.delivered;
    results.outboxFailed += outboxRes.failed;
    results.errors.push(...outboxRes.errors);

    // 7. Expire stale checkouts and reservations
    try {
      const expiredCount = await expireStaleCheckouts();
      results.reconciledCheckouts = expiredCount;
    } catch (err: any) {
      results.errors.push(`Stale checkout cleanup error: ${err?.message}`);
    }

    return NextResponse.json({ ok: true, results }, { status: 200 });
  } finally {
    await releaseSlotMutex(lockKey, mutex.token).catch(() => undefined);
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
