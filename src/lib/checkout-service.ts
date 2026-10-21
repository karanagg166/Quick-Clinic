import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { acquireSlotMutex, releaseSlotMutex } from "@/lib/slot-mutex";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  verifyCheckoutSignature,
  RazorpayPaymentDetails,
} from "@/lib/razorpay";
import { claimAndExecuteRefund } from "@/lib/payment-booking-service";
import { persistBookingSideEffectsTx, dispatchPendingOutboxEvents } from "@/lib/appointment-confirmation";
import { logAudit } from "@/lib/logger";
import type {
  InitiateCheckoutParams,
  InitiateCheckoutResult,
  VerifyCheckoutParams,
  VerifyCheckoutResult,
} from "@/lib/checkout-types";
import type { Checkout, CheckoutStatus, Prisma } from "@/generated/prisma";

export const CHECKOUT_RESERVATION_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Transaction 1: Claims attempt, validates prerequisites, snapshots doctor fee,
 * and atomically reserves the slot.
 * Releases Redis mutex immediately after Transaction 1 commits.
 * Provider order creation happens strictly OUTSIDE Transaction 1.
 */
export async function initiateCheckout(params: InitiateCheckoutParams): Promise<InitiateCheckoutResult> {
  const { userId, patientId, doctorId, slotId, paymentMethod, idempotencyKey } = params;

  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    const err = new Error("A valid idempotencyKey (between 8 and 128 characters) is required");
    (err as any).statusCode = 400;
    throw err;
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  if (paymentMethod === "ONLINE" && (!keyId || !process.env.RAZORPAY_KEY_SECRET)) {
    const err = new Error("Razorpay credentials missing from environment");
    (err as any).statusCode = 500;
    throw err;
  }

  // 1. Acquire short Redis mutex (TTL 5s)
  const mutex = await acquireSlotMutex(slotId);
  if (!mutex.acquired && mutex.retryable) {
    const err = new Error("Slot is currently being processed by another request. Please retry in a moment.");
    (err as any).statusCode = 409;
    throw err;
  }

  let reservationToken: string = randomUUID();
  let checkoutRecord: Checkout;
  let isOfflineDirectSuccess = false;
  let offlineAppointment: any = null;
  let offlineEventIds: { doctorEventId: string; patientEventId: string } | null = null;

  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHECKOUT_RESERVATION_TTL_MS);

    // 2. Transaction 1: Claim attempt & reserve slot
    const txResult = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 2a. Check if checkout with idempotencyKey already exists
      const existingByKey = await tx.checkout.findUnique({
        where: { idempotencyKey },
        include: { appointment: true, payment: true },
      });

      if (existingByKey) {
        if (
          existingByKey.userId !== userId ||
          existingByKey.doctorId !== doctorId ||
          existingByKey.slotId !== slotId ||
          existingByKey.paymentMethod !== paymentMethod
        ) {
          const err = new Error("Idempotency key has already been used with different booking details");
          (err as any).statusCode = 409;
          throw err;
        }

        return { existing: existingByKey };
      }

      // 2b. Authoritatively validate doctor availability & fee
      const doctor = await tx.doctor.findUnique({
        where: { id: doctorId },
        select: { fees: true },
      });
      if (!doctor) {
        const err = new Error("Doctor not found");
        (err as any).statusCode = 404;
        throw err;
      }

      const amountInPaise = Math.round(doctor.fees * 100);
      if (!Number.isSafeInteger(amountInPaise) || amountInPaise < 100) {
        const err = new Error("The doctor has not configured a valid consultation fee.");
        (err as any).statusCode = 400;
        throw err;
      }

      // 2c. Validate slot future time and active appointment invariants
      const slot = await tx.slot.findUnique({
        where: { id: slotId },
        select: { id: true, doctorId: true, startTime: true, status: true },
      });
      if (!slot || slot.doctorId !== doctorId) {
        const err = new Error("Slot not found for this doctor");
        (err as any).statusCode = 404;
        throw err;
      }

      if (new Date(slot.startTime) <= now) {
        const err = new Error("Cannot book appointment for a time slot that has already passed.");
        (err as any).statusCode = 400;
        throw err;
      }

      const activeAppointment = await tx.appointment.findFirst({
        where: {
          slotId,
          status: { in: ["PENDING", "CONFIRMED", "COMPLETED", "NO_SHOW"] },
        },
      });
      if (activeAppointment) {
        const err = new Error("This slot is already booked");
        (err as any).statusCode = 409;
        throw err;
      }

      // 2d. OFFLINE Branch: Atomic direct booking in Transaction 1
      if (paymentMethod === "OFFLINE") {
        const slotBooked = await tx.slot.updateMany({
          where: {
            id: slotId,
            doctorId,
            status: "AVAILABLE",
            startTime: { gt: now },
          },
          data: {
            status: "BOOKED",
            heldByPatientId: null,
            heldAt: null,
            holdToken: null,
            holdExpiresAt: null,
          },
        });

        if (slotBooked.count !== 1) {
          const err = new Error("This slot is no longer available");
          (err as any).statusCode = 409;
          throw err;
        }

        const appt = await tx.appointment.create({
          data: {
            doctorId,
            patientId,
            slotId,
            status: "CONFIRMED",
            paymentMethod: "OFFLINE",
            isAppointmentOffline: true,
          },
        });

        const createdCheckout = await tx.checkout.create({
          data: {
            idempotencyKey,
            userId,
            patientId,
            doctorId,
            slotId,
            holdToken: reservationToken,
            paymentMethod: "OFFLINE",
            amount: amountInPaise,
            currency: "INR",
            status: "CONFIRMED",
            expiresAt,
            confirmedAt: now,
            appointmentId: appt.id,
          },
        });

        // Persist notification and outbox intents in the same database transaction
        const eventIds = await persistBookingSideEffectsTx(tx, {
          appointmentId: appt.id,
          doctorId,
          patientId,
          patientUserId: userId,
          slotId,
          paymentMethod: "OFFLINE",
        });

        return { created: createdCheckout, appointment: appt, isOffline: true, eventIds };
      }

      // 2e. ONLINE Branch: Atomically reserve slot as HELD
      const slotHeld = await tx.slot.updateMany({
        where: {
          id: slotId,
          doctorId,
          startTime: { gt: now },
          OR: [
            { status: "AVAILABLE" },
            { status: "HELD", holdExpiresAt: { lte: now } },
          ],
        },
        data: {
          status: "HELD",
          heldByPatientId: patientId,
          heldAt: now,
          holdToken: reservationToken,
          holdExpiresAt: expiresAt,
        },
      });

      if (slotHeld.count !== 1) {
        const err = new Error("This slot is no longer available");
        (err as any).statusCode = 409;
        throw err;
      }

      const createdCheckout = await tx.checkout.create({
        data: {
          idempotencyKey,
          userId,
          patientId,
          doctorId,
          slotId,
          holdToken: reservationToken,
          paymentMethod: "ONLINE",
          amount: amountInPaise,
          currency: "INR",
          status: "PENDING_ORDER",
          expiresAt,
        },
      });

      return { created: createdCheckout, isOffline: false };
    }, { timeout: 15000, maxWait: 10000 });

    if (txResult.existing) {
      const existing = txResult.existing;
      const nowTime = new Date();
      const isExpired = existing.status === "EXPIRED" || (existing.status !== "CONFIRMED" && nowTime >= existing.expiresAt);

      if (isExpired) {
        return {
          ok: false,
          checkoutId: existing.id,
          status: "EXPIRED",
          paymentMethod: existing.paymentMethod,
          amount: existing.amount,
          currency: existing.currency,
          expiresAt: existing.expiresAt.toISOString(),
          orderId: undefined, // Expired attempts must never be presented as reusable payable orders
          reused: true,
          canRestart: true,
          error: "Checkout reservation has expired. Please initiate a new booking.",
        };
      }

      if (existing.status === "CONFIRMED") {
        return {
          ok: true,
          checkoutId: existing.id,
          status: "CONFIRMED",
          paymentMethod: existing.paymentMethod,
          amount: existing.amount,
          currency: existing.currency,
          expiresAt: existing.expiresAt.toISOString(),
          orderId: existing.razorpayOrderId,
          keyId: keyId || undefined,
          reused: true,
          appointment: existing.appointment || undefined,
        };
      }

      if (existing.status === "READY_FOR_PAYMENT" && existing.razorpayOrderId) {
        return {
          ok: true,
          checkoutId: existing.id,
          status: "READY_FOR_PAYMENT",
          paymentMethod: existing.paymentMethod,
          amount: existing.amount,
          currency: existing.currency,
          expiresAt: existing.expiresAt.toISOString(),
          orderId: existing.razorpayOrderId,
          keyId: keyId || undefined,
          reused: true,
        };
      }

      if (existing.status === "PENDING_ORDER" || existing.status === "UNRESOLVED") {
        if (existing.razorpayOrderId) {
          return {
            ok: true,
            checkoutId: existing.id,
            status: "READY_FOR_PAYMENT",
            paymentMethod: existing.paymentMethod,
            amount: existing.amount,
            currency: existing.currency,
            expiresAt: existing.expiresAt.toISOString(),
            orderId: existing.razorpayOrderId,
            keyId: keyId || undefined,
            reused: true,
          };
        }
        return {
          ok: false,
          checkoutId: existing.id,
          status: existing.status,
          paymentMethod: existing.paymentMethod,
          amount: existing.amount,
          currency: existing.currency,
          expiresAt: existing.expiresAt.toISOString(),
          reused: true,
          canRetry: true,
          message: "Payment order initialization is in progress. Please check status or retry shortly.",
        };
      }

      return {
        ok: false,
        checkoutId: existing.id,
        status: existing.status,
        paymentMethod: existing.paymentMethod,
        amount: existing.amount,
        currency: existing.currency,
        expiresAt: existing.expiresAt.toISOString(),
        reused: true,
        canRestart: existing.status === "FAILED",
        error: existing.status === "FAILED" ? "Checkout failed. Please initiate a new booking." : undefined,
      };
    }

    checkoutRecord = txResult.created!;
    if (txResult.isOffline) {
      isOfflineDirectSuccess = true;
      offlineAppointment = txResult.appointment;
      offlineEventIds = txResult.eventIds ?? null;
    }
  } finally {
    // Safely release short Redis mutex immediately after Transaction 1
    await releaseSlotMutex(slotId, mutex.token).catch((err) => {
      console.warn("[initiateCheckout] Mutex release warning:", err);
    });
  }

  // If OFFLINE, Transaction 1 already completed booking and persisted side effects; dispatch outbox and return
  if (isOfflineDirectSuccess && offlineAppointment) {
    await logAudit(userId, "Booked Appointment (Offline)", {
      appointmentId: offlineAppointment.id,
      doctorId,
      slotId,
    }).catch(() => undefined);

    if (offlineEventIds) {
      void dispatchPendingOutboxEvents([offlineEventIds.doctorEventId, offlineEventIds.patientEventId]);
    }

    return {
      ok: true,
      checkoutId: checkoutRecord.id,
      status: "CONFIRMED",
      paymentMethod: "OFFLINE",
      amount: checkoutRecord.amount,
      currency: checkoutRecord.currency,
      expiresAt: checkoutRecord.expiresAt.toISOString(),
      appointment: offlineAppointment,
      reused: false,
    };
  }

  // 3. ONLINE Branch: Create Razorpay Order OUTSIDE Transaction 1
  if (new Date() >= checkoutRecord.expiresAt) {
    await prisma.checkout.updateMany({
      where: { id: checkoutRecord.id, status: "PENDING_ORDER" },
      data: { status: "EXPIRED" },
    });
    const err = new Error("Reservation expired before payment order creation could complete");
    (err as any).statusCode = 409;
    throw err;
  }

  let providerOrder: any;
  try {
    providerOrder = await createRazorpayOrder({
      amount: checkoutRecord.amount,
      currency: checkoutRecord.currency,
      receipt: `rcpt_${checkoutRecord.id.slice(0, 30)}`,
      notes: {
        checkoutId: checkoutRecord.id,
        userId,
        doctorId,
        slotId,
        idempotencyKey,
      },
      timeoutMs: 10000,
    });
  } catch (providerError: any) {
    const errorMsg = providerError instanceof Error ? providerError.message : String(providerError);
    console.error(`[initiateCheckout] Razorpay order creation failed for checkout ${checkoutRecord.id}:`, errorMsg);

    const isTimeout =
      errorMsg.toLowerCase().includes("timeout") ||
      errorMsg.toLowerCase().includes("abort") ||
      errorMsg.toLowerCase().includes("econnreset");

    if (isTimeout) {
      // Provider state uncertain: record UNRESOLVED for recovery/reconciliation
      await prisma.checkout.update({
        where: { id: checkoutRecord.id },
        data: { status: "UNRESOLVED" },
      });

      const err = new Error("Payment provider timed out. Your reservation is held while we verify order status.");
      (err as any).statusCode = 504;
      throw err;
    }

    // Definite failure: release slot and mark FAILED
    await prisma.$transaction([
      prisma.checkout.update({
        where: { id: checkoutRecord.id },
        data: { status: "FAILED" },
      }),
      prisma.slot.updateMany({
        where: {
          id: slotId,
          doctorId,
          status: "HELD",
          heldByPatientId: patientId,
          holdToken: checkoutRecord.holdToken,
        },
        data: {
          status: "AVAILABLE",
          heldByPatientId: null,
          heldAt: null,
          holdToken: null,
          holdExpiresAt: null,
        },
      }),
    ]);

    const err = new Error(errorMsg || "Failed to initialize payment gateway order");
    (err as any).statusCode = 502;
    throw err;
  }

  // 4. Atomically persist provider order reference and transition to READY_FOR_PAYMENT
  let updatedCheckout: Checkout;

  const orderPersistResult = await prisma.$transaction(async (tx) => {
    let payment = await tx.payment.findUnique({
      where: { razorpayOrderId: providerOrder.id },
    });
    if (!payment) {
      payment = await tx.payment.create({
        data: {
          userId,
          doctorId,
          slotId,
          holdToken: checkoutRecord.holdToken,
          amount: checkoutRecord.amount,
          currency: checkoutRecord.currency,
          status: "CREATED",
          razorpayOrderId: providerOrder.id,
          idempotencyKey: `pay_${idempotencyKey}`,
        },
      });
    }

    const now = new Date();
    // Guarded transition: only transition to READY_FOR_PAYMENT if checkout is still PENDING_ORDER or UNRESOLVED and NOT expired!
    const updated = await tx.checkout.updateMany({
      where: {
        id: checkoutRecord.id,
        status: { in: ["PENDING_ORDER", "UNRESOLVED"] },
        expiresAt: { gt: now },
      },
      data: {
        status: "READY_FOR_PAYMENT",
        razorpayOrderId: providerOrder.id,
        paymentId: payment.id,
      },
    });

    if (updated.count === 0) {
      // Late provider response arrived after expiry or concurrent transition:
      // Preserve provider order reference so reconciliation/webhooks can locate it,
      // but do NOT make it payable! Keep/set status to EXPIRED.
      await tx.checkout.updateMany({
        where: { id: checkoutRecord.id },
        data: {
          razorpayOrderId: providerOrder.id,
          paymentId: payment.id,
          status: "EXPIRED",
        },
      });
      return { payment, expired: true };
    }

    const freshCheckout = await tx.checkout.findUniqueOrThrow({
      where: { id: checkoutRecord.id },
    });
    return { payment, checkout: freshCheckout, expired: false };
  });

  if (orderPersistResult.expired) {
    const err = new Error("Reservation expired before payment order creation could complete");
    (err as any).statusCode = 409;
    throw err;
  }

  updatedCheckout = orderPersistResult.checkout!;

  return {
    ok: true,
    checkoutId: updatedCheckout.id,
    status: updatedCheckout.status,
    paymentMethod: "ONLINE",
    amount: updatedCheckout.amount,
    currency: updatedCheckout.currency,
    expiresAt: updatedCheckout.expiresAt.toISOString(),
    orderId: providerOrder.id,
    keyId: keyId!,
    reused: false,
  };
}

/**
 * Shared Payment Verification & Transaction 2.
 * Validates HMAC and authoritative provider details, enforces strict expiry policy,
 * and atomically books the appointment, updates checkout to CONFIRMED, and updates Payment.
 */
export async function verifyAndFinalizeCheckout(params: VerifyCheckoutParams): Promise<VerifyCheckoutResult> {
  const { userId, checkoutId, orderId, paymentId, signature, source } = params;

  // 1. Locate checkout record with deterministic reference resolution
  const conditions: Prisma.CheckoutWhereInput[] = [];
  if (checkoutId && checkoutId.trim()) conditions.push({ id: checkoutId.trim() });
  if (orderId && orderId.trim()) conditions.push({ razorpayOrderId: orderId.trim() });
  if (paymentId && paymentId.trim()) conditions.push({ payment: { razorpayPaymentId: paymentId.trim() } });

  if (conditions.length === 0) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: "At least one valid checkoutId, orderId, or paymentId is required",
    };
  }

  const checkout = await prisma.checkout.findFirst({
    where: {
      OR: conditions,
    },
    include: {
      appointment: true,
      payment: true,
      slot: true,
    },
  });

  if (!checkout) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 404,
      error: "Checkout record not found",
    };
  }

  // Enforce reference consistency if both checkoutId and orderId were supplied
  if (checkoutId && checkout.id !== checkoutId.trim()) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: "Provided checkoutId does not match the resolved checkout record",
    };
  }
  if (orderId && checkout.razorpayOrderId && checkout.razorpayOrderId !== orderId.trim()) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: "Provided orderId does not match the resolved checkout record",
    };
  }

  // 2. Patient identity verification
  if (source === "CHECKOUT" && checkout.userId !== userId) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 403,
      error: "Authentication required: checkout does not belong to user",
    };
  }

  // 3. If already CONFIRMED, idempotently return canonical appointment with stored transaction identity
  if (checkout.status === "CONFIRMED") {
    let existingAppointment =
      checkout.appointment ||
      (await prisma.appointment.findFirst({
        where: {
          OR: [
            { checkout: { id: checkout.id } },
            ...(checkout.paymentId ? [{ paymentId: checkout.paymentId }] : []),
            ...(checkout.slotId ? [{ slotId: checkout.slotId, doctorId: checkout.doctorId, patientId: checkout.patientId }] : []),
          ],
        },
      }));

    if (!existingAppointment) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        existingAppointment = await prisma.appointment.findFirst({
          where: {
            OR: [
              { checkout: { id: checkout.id } },
              ...(checkout.paymentId ? [{ paymentId: checkout.paymentId }] : []),
              ...(checkout.slotId ? [{ slotId: checkout.slotId, doctorId: checkout.doctorId, patientId: checkout.patientId }] : []),
            ],
          },
        });
        if (existingAppointment) break;
      }
    }

    if (existingAppointment) {
      const storedTransactionId =
        checkout.payment?.razorpayPaymentId ||
        existingAppointment.transactionId ||
        checkout.razorpayOrderId ||
        paymentId;

      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified and appointment confirmed",
        transactionId: storedTransactionId,
        appointment: existingAppointment,
      };
    }
  }

  // 4. Validate checkout signature if from client browser
  if (source === "CHECKOUT" && signature) {
    const providerOrderId = checkout.razorpayOrderId || orderId;
    if (!providerOrderId) {
      return {
        success: false,
        status: "ERROR",
        statusCode: 400,
        error: "Missing orderId for checkout signature verification",
      };
    }

    const isValidSig = verifyCheckoutSignature({
      orderId: providerOrderId,
      paymentId,
      signature,
    });

    if (!isValidSig) {
      return {
        success: false,
        status: "ERROR",
        statusCode: 400,
        error: "Invalid signature",
      };
    }
  }

  // 5. Authoritative provider lookup
  let providerPayment: RazorpayPaymentDetails;
  try {
    providerPayment = await fetchRazorpayPayment(paymentId, 10000, checkout.razorpayOrderId || undefined);
  } catch (fetchErr: any) {
    console.error(`[verifyAndFinalizeCheckout] Provider payment fetch failed for ${paymentId}:`, fetchErr);
    return {
      success: false,
      status: "ERROR",
      statusCode: 502,
      error: "Failed to communicate with payment provider. Please retry.",
    };
  }

  // 6. Invariant verification
  if (checkout.razorpayOrderId && providerPayment.order_id !== checkout.razorpayOrderId) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: "Payment is not associated with this order ID",
    };
  }

  if (Number(providerPayment.amount) !== checkout.amount) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: `Payment amount mismatch: expected ${checkout.amount} paise, received ${providerPayment.amount} paise`,
    };
  }

  if (providerPayment.currency !== checkout.currency) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: `Payment currency mismatch: expected ${checkout.currency}, received ${providerPayment.currency}`,
    };
  }

  if (providerPayment.status === "failed") {
    // Only fail the payment attempt record; do not terminally fail an unexpired checkout if another payment attempt can succeed
    if (checkout.paymentId) {
      await prisma.payment.updateMany({
        where: { id: checkout.paymentId },
        data: { status: "FAILED", razorpayPaymentId: paymentId },
      });
    }
    return {
      success: false,
      status: "FAILED",
      statusCode: 400,
      error: providerPayment.error_description || "Payment was failed by provider",
    };
  }

  if (providerPayment.status === "authorized" && !providerPayment.captured) {
    return {
      success: false,
      status: "PENDING_CAPTURE",
      statusCode: 202,
      message: "Payment authorized but capture is pending. Booking will be confirmed once capture completes.",
    };
  }

  if (providerPayment.status !== "captured" || !providerPayment.captured) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: `Payment is not in captured status (current: ${providerPayment.status})`,
    };
  }

  // 7. Strict Expiry Check: Late payment does NOT reclaim expired slot
  const now = new Date();
  const isExpired = checkout.status === "EXPIRED" || now >= checkout.expiresAt;

  if (isExpired) {
    console.warn(`[verifyAndFinalizeCheckout] Reservation expired for checkout ${checkout.id}. Triggering refund compensation.`);

    // Guarded transition: only mark EXPIRED if still non-terminal
    await prisma.checkout.updateMany({
      where: {
        id: checkout.id,
        status: { in: ["PENDING_ORDER", "READY_FOR_PAYMENT", "UNRESOLVED"] },
      },
      data: { status: "EXPIRED" },
    });

    // Guard against concurrent confirmation race
    const rechecked = await prisma.checkout.findUnique({
      where: { id: checkout.id },
      include: { appointment: true },
    });
    if (rechecked?.status === "CONFIRMED" && rechecked.appointment) {
      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified and appointment confirmed",
        transactionId: paymentId,
        appointment: rechecked.appointment,
      };
    }

    // Atomically record verified captured-payment identity before refund execution
    const capturedAt = new Date(providerPayment.created_at * 1000 || Date.now());
    if (checkout.paymentId) {
      await prisma.payment.updateMany({
        where: { id: checkout.paymentId, razorpayPaymentId: null },
        data: { razorpayPaymentId: paymentId, capturedAt },
      });
    }

    // Stable compensation identity for this checkout business event
    const refundRes = await claimAndExecuteRefund({
      paymentId: checkout.paymentId || checkout.id,
      providerPaymentId: paymentId,
      reason: "Reservation expired before payment completion; late slot reclaim prohibited",
      initiatedBy: "SYSTEM",
      idempotencyKey: `refund_checkout_${checkout.id}`,
      amount: checkout.amount,
    });

    return {
      success: false,
      status: "SLOT_UNAVAILABLE_REFUNDED",
      statusCode: 409,
      error: "SLOT_UNAVAILABLE_REFUNDED",
      message: "Your reservation expired before payment was completed. Your payment has been refunded or is being processed for refund.",
      refundStatus: refundRes.status,
      transactionId: paymentId,
    };
  }

  // 8. Transaction 2: Atomic finalization
  const capturedAt = new Date(providerPayment.created_at * 1000 || Date.now());
  let txEventIds: { doctorEventId: string; patientEventId: string } | null = null;

  try {
    const txOutcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 8a. Atomically claim Checkout transition
      const claimedCheckout = await tx.checkout.updateMany({
        where: {
          id: checkout.id,
          status: { in: ["PENDING_ORDER", "READY_FOR_PAYMENT", "UNRESOLVED"] },
          expiresAt: { gt: now },
        },
        data: {
          status: "CONFIRMED",
          confirmedAt: now,
        },
      });

      if (claimedCheckout.count === 0) {
        // Concurrently claimed or expired
        const currentCheckout = await tx.checkout.findUnique({
          where: { id: checkout.id },
          include: { appointment: true },
        });
        if (currentCheckout?.status === "CONFIRMED" && currentCheckout.appointment) {
          return { appointment: currentCheckout.appointment, eventIds: null };
        }
        throw new Error("CHECKOUT_UNAVAILABLE");
      }

      // 8b. Atomically update Slot from HELD to BOOKED
      const slotTransitioned = await tx.slot.updateMany({
        where: {
          id: checkout.slotId,
          doctorId: checkout.doctorId,
          status: "HELD",
          heldByPatientId: checkout.patientId,
          holdToken: checkout.holdToken,
          startTime: { gt: now },
          OR: [
            { holdExpiresAt: { gt: now } },
            { holdExpiresAt: null },
          ],
        },
        data: {
          status: "BOOKED",
          heldByPatientId: null,
          heldAt: null,
          holdToken: null,
          holdExpiresAt: null,
        },
      });

      if (slotTransitioned.count !== 1) {
        throw new Error("SLOT_UNAVAILABLE");
      }

      // 8c. Create exactly one Appointment linked to payment & checkout
      const appt = await tx.appointment.create({
        data: {
          doctorId: checkout.doctorId,
          patientId: checkout.patientId,
          slotId: checkout.slotId,
          paymentId: checkout.paymentId ?? null,
          status: "CONFIRMED",
          paymentMethod: "ONLINE",
          transactionId: paymentId,
          isAppointmentOffline: false,
        },
      });

      // 8d. Link appointment to Checkout and update Payment
      await tx.checkout.update({
        where: { id: checkout.id },
        data: {
          appointmentId: appt.id,
        },
      });

      if (checkout.paymentId) {
        await tx.payment.update({
          where: { id: checkout.paymentId },
          data: {
            status: "SUCCESS",
            razorpayPaymentId: paymentId,
            capturedAt,
          },
        });
      }

      // 8e. Atomically persist notifications, chat messages, and outbox intents
      const eventIds = await persistBookingSideEffectsTx(tx, {
        appointmentId: appt.id,
        doctorId: checkout.doctorId,
        patientId: checkout.patientId,
        patientUserId: checkout.userId,
        slotId: checkout.slotId,
        paymentMethod: "ONLINE",
      });

      return { appointment: appt, eventIds };
    }, { timeout: 15000, maxWait: 10000 });

    const finalAppointment = txOutcome.appointment;
    const txEventIds = txOutcome.eventIds;

    // 9. Asynchronously dispatch outbox events outside Transaction 2
    await logAudit(checkout.userId, "Booked Appointment", {
      appointmentId: finalAppointment.id,
      doctorId: checkout.doctorId,
      slotId: checkout.slotId,
      paymentId,
    }).catch(() => undefined);

    if (txEventIds) {
      void dispatchPendingOutboxEvents([txEventIds.doctorEventId, txEventIds.patientEventId]);
    }

    return {
      success: true,
      status: "SUCCESS",
      statusCode: 200,
      message: "Payment verified and appointment confirmed",
      transactionId: paymentId,
      appointment: finalAppointment,
    };
  } catch (txError: any) {
    console.error(`[verifyAndFinalizeCheckout] Finalization failed for checkout ${checkout.id}:`, txError?.message);

    // If slot or checkout was claimed concurrently, check if the concurrent request confirmed the booking
    let confirmedCheckout = await prisma.checkout.findUnique({
      where: { id: checkout.id },
      include: { appointment: true },
    });

    if (confirmedCheckout?.status === "CONFIRMED" && confirmedCheckout.appointment) {
      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified and appointment confirmed",
        transactionId: paymentId,
        appointment: confirmedCheckout.appointment,
      };
    }

    if (confirmedCheckout?.status === "CONFIRMED" && !confirmedCheckout.appointment) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        confirmedCheckout = await prisma.checkout.findUnique({
          where: { id: checkout.id },
          include: { appointment: true },
        });
        if (confirmedCheckout?.appointment) break;
      }
      if (confirmedCheckout?.appointment) {
        return {
          success: true,
          status: "SUCCESS",
          statusCode: 200,
          message: "Payment verified and appointment confirmed",
          transactionId: paymentId,
          appointment: confirmedCheckout.appointment,
        };
      }
    }

    let concurrentAppt = await prisma.appointment.findFirst({
      where: {
        OR: [
          { checkout: { id: checkout.id } },
          ...(checkout.paymentId ? [{ paymentId: checkout.paymentId }] : []),
          { transactionId: paymentId },
        ],
      },
    });
    if (concurrentAppt) {
      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified and appointment confirmed",
        transactionId: paymentId,
        appointment: concurrentAppt,
      };
    }

    // If slot was unavailable or hold expired during race, execute automatic refund compensation
    if (txError?.message === "SLOT_UNAVAILABLE" || txError?.message === "CHECKOUT_UNAVAILABLE") {
      // Atomically record verified captured-payment identity before refund execution
      if (checkout.paymentId) {
        await prisma.payment.updateMany({
          where: { id: checkout.paymentId, razorpayPaymentId: null },
          data: { razorpayPaymentId: paymentId, capturedAt },
        });
      }

      // Same stable refund idempotency key for this checkout business event
      const refundRes = await claimAndExecuteRefund({
        paymentId: checkout.paymentId || checkout.id,
        providerPaymentId: paymentId,
        reason: "Automatic compensation: slot unavailable during finalization",
        initiatedBy: "SYSTEM",
        idempotencyKey: `refund_checkout_${checkout.id}`,
        amount: checkout.amount,
      });

      return {
        success: false,
        status: "SLOT_UNAVAILABLE_REFUNDED",
        statusCode: 409,
        error: "SLOT_UNAVAILABLE_REFUNDED",
        message: "The requested slot is no longer available. Your payment has been refunded or is being processed for refund.",
        refundStatus: refundRes.status,
        transactionId: paymentId,
      };
    }

    throw txError;
  }
}

/**
 * Returns authoritative checkout, payment, appointment, and refund status.
 */
export async function getAuthoritativeCheckoutStatus(checkoutIdOrOrderId: string, userId: string) {
  if (!checkoutIdOrOrderId || typeof checkoutIdOrOrderId !== "string" || !checkoutIdOrOrderId.trim()) {
    return null;
  }

  const lookup = checkoutIdOrOrderId.trim();
  const checkout = await prisma.checkout.findFirst({
    where: {
      userId,
      OR: [
        { id: lookup },
        { razorpayOrderId: lookup },
      ],
    },
    include: {
      appointment: {
        include: {
          slot: true,
          doctor: {
            include: { user: { select: { name: true, email: true } } },
          },
        },
      },
      payment: {
        include: {
          refunds: {
            orderBy: { createdAt: "desc" },
          },
        },
      },
      doctor: {
        include: { user: { select: { name: true, email: true } } },
      },
      slot: true,
    },
  });

  if (!checkout || checkout.userId !== userId) {
    return null;
  }

  const latestRefund = checkout.payment?.refunds?.[0] || null;

  return {
    checkoutId: checkout.id,
    orderId: checkout.razorpayOrderId,
    paymentId: checkout.payment?.razorpayPaymentId,
    amount: checkout.amount,
    currency: checkout.currency,
    status: checkout.status,
    paymentMethod: checkout.paymentMethod,
    expiresAt: checkout.expiresAt,
    confirmedAt: checkout.confirmedAt,
    appointment: checkout.appointment
      ? {
          id: checkout.appointment.id,
          status: checkout.appointment.status,
          slotId: checkout.appointment.slotId,
          slotDate: checkout.appointment.slot.date,
          slotStartTime: checkout.appointment.slot.startTime,
          doctorName: checkout.appointment.doctor.user.name,
        }
      : null,
    refund: latestRefund
      ? {
          id: latestRefund.id,
          status: latestRefund.status,
          amount: latestRefund.amount,
          reason: latestRefund.reason,
          processedAt: latestRefund.processedAt,
        }
      : null,
    refundStatus: latestRefund
      ? latestRefund.status === "PROCESSED"
        ? "REFUNDED"
        : latestRefund.status === "PENDING"
        ? "REFUND_PENDING"
        : latestRefund.status === "FAILED"
        ? "FAILED"
        : undefined
      : checkout.payment?.status === "REFUNDED"
      ? "REFUNDED"
      : undefined,
  };
}

/**
 * Clean up expired checkouts and release associated slot reservations safely.
 * Coordinates with database time and guards against overwriting CONFIRMED checkouts.
 * Old cleanup cannot release a newer patient's reservation!
 */
export async function expireStaleCheckouts() {
  const now = new Date();
  const staleCheckouts = await prisma.checkout.findMany({
    where: {
      status: { in: ["PENDING_ORDER", "READY_FOR_PAYMENT", "UNRESOLVED"] },
      expiresAt: { lte: now },
    },
    take: 50,
  });

  let expiredCount = 0;
  for (const checkout of staleCheckouts) {
    try {
      await prisma.$transaction(async (tx) => {
        // Guarded transition: only claim expiry if still in an eligible state and actually expired!
        const claimed = await tx.checkout.updateMany({
          where: {
            id: checkout.id,
            status: { in: ["PENDING_ORDER", "READY_FOR_PAYMENT", "UNRESOLVED"] },
            expiresAt: { lte: now },
          },
          data: { status: "EXPIRED" },
        });

        // Release slot ONLY if the checkout expiry claim succeeded and exact reservation ownership matches
        if (claimed.count === 1) {
          await tx.slot.updateMany({
            where: {
              id: checkout.slotId,
              doctorId: checkout.doctorId,
              status: "HELD",
              heldByPatientId: checkout.patientId,
              holdToken: checkout.holdToken,
            },
            data: {
              status: "AVAILABLE",
              heldByPatientId: null,
              heldAt: null,
              holdToken: null,
              holdExpiresAt: null,
            },
          });
          expiredCount++;
        }
      });
    } catch (e) {
      console.warn(`[expireStaleCheckouts] Error expiring checkout ${checkout.id}:`, e);
    }
  }

  return expiredCount;
}
