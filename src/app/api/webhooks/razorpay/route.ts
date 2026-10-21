import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { verifyWebhookSignature } from "@/lib/razorpay";
import { processSingleWebhookEvent } from "@/lib/webhook-processor";

export async function POST(req: NextRequest) {
  let rawBody = "";
  try {
    rawBody = await req.text();
  } catch {
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
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const eventType = typeof event.event === "string" ? event.event : "unknown";

  // Use a stable deterministic event identity: provider ID or SHA-256 hash of payload
  const providerEventId =
    req.headers.get("x-razorpay-event-id") ||
    event.id ||
    event.event_id ||
    crypto.createHash("sha256").update(rawBody).digest("hex");

  // 1. Store or claim event durably with idempotency deduplication
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
      storedEvent = await prisma.webhookEvent.findUnique({
        where: { providerEventId },
      });
      if (!storedEvent) {
        return NextResponse.json({ error: "Failed to locate existing event" }, { status: 500 });
      }

      // If already processed or ignored, return 200 immediately
      if (storedEvent.status === "PROCESSED" || storedEvent.status === "IGNORED") {
        return NextResponse.json({ received: true, duplicate: true, status: storedEvent.status }, { status: 200 });
      }

      // If currently processing under an active lease, avoid double-execution
      if (
        storedEvent.status === "PROCESSING" &&
        storedEvent.leaseExpiresAt &&
        new Date() < storedEvent.leaseExpiresAt
      ) {
        return NextResponse.json({ received: true, duplicate: true, status: "PROCESSING" }, { status: 200 });
      }
    } else {
      console.error("[Webhook] Failed to store webhook event:", dbErr);
      return NextResponse.json({ error: "Database error persisting event" }, { status: 500 });
    }
  }

  // 2. Atomically claim event lease for processing
  const workerId = `wh_post_${process.pid}_${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const claimed = await prisma.webhookEvent.updateMany({
    where: {
      id: storedEvent.id,
      status: { in: ["RECEIVED", "FAILED", "PROCESSING"] },
      OR: [
        { leaseExpiresAt: null },
        { leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      status: "PROCESSING",
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      processingStartedAt: now,
      processingError: null,
    },
  });

  if (claimed.count === 0 && storedEvent.status !== "RECEIVED") {
    return NextResponse.json({ received: true, duplicate: true }, { status: 200 });
  }

  // 3. Process the event payload authoritatively
  try {
    const outcome = await processSingleWebhookEvent({
      id: storedEvent.id,
      eventType,
      payload: event,
    });

    if (outcome.success) {
      await prisma.webhookEvent.updateMany({
        where: { id: storedEvent.id, leaseOwner: workerId },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          processingError: null,
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return NextResponse.json({ received: true, processed: true }, { status: 200 });
    }

    if (outcome.unlinked) {
      // Unmatched early event: keep in RECEIVED status so reconciliation can retry after order linkage
      await prisma.webhookEvent.updateMany({
        where: { id: storedEvent.id, leaseOwner: workerId },
        data: {
          status: "RECEIVED",
          processingError: outcome.error,
          nextAttemptAt: new Date(Date.now() + 30_000),
          leaseOwner: null,
          leaseExpiresAt: null,
        },
      });
      return NextResponse.json({ received: true, pendingLinkage: true }, { status: 200 });
    }

    // Failed processing: mark FAILED for durable retry and cron replay
    await prisma.webhookEvent.updateMany({
      where: { id: storedEvent.id, leaseOwner: workerId },
      data: {
        status: "FAILED",
        processingError: outcome.error || "Event processing failed",
        nextAttemptAt: new Date(Date.now() + 60_000),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });

    return NextResponse.json({ received: true, error: outcome.error }, { status: 200 });
  } catch (processErr: any) {
    const errorMsg = processErr instanceof Error ? processErr.message : String(processErr);
    console.error(`[Webhook] Error processing event ${providerEventId}:`, errorMsg);

    await prisma.webhookEvent.updateMany({
      where: { id: storedEvent.id, leaseOwner: workerId },
      data: {
        status: "FAILED",
        processingError: errorMsg,
        nextAttemptAt: new Date(Date.now() + 60_000),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    }).catch(() => undefined);

    return NextResponse.json({ received: true, error: errorMsg }, { status: 200 });
  }
}
