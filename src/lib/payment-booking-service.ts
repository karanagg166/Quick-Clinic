import { prisma } from "@/lib/prisma";
import { validateSlotHold } from "@/lib/booking";
import { finalizeAppointmentBooking } from "@/lib/appointment-confirmation";
import {
  createRazorpayOrder,
  fetchRazorpayPayment,
  createRazorpayRefund,
  verifyCheckoutSignature,
  RazorpayPaymentDetails,
} from "@/lib/razorpay";
import { Payment, Refund } from "@/generated/prisma";

export interface CreateOrderParams {
  userId: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  holdToken: string;
  idempotencyKey: string;
}

export interface VerifyPaymentParams {
  orderId: string;
  paymentId: string;
  signature?: string;
  patientUserId?: string;
  source: "CHECKOUT" | "WEBHOOK" | "RECONCILIATION";
}

export interface PaymentTransitionResult {
  success: boolean;
  status: "SUCCESS" | "REFUNDED" | "REFUND_PENDING" | "FAILED" | "PENDING_CAPTURE" | "SLOT_UNAVAILABLE_REFUNDED" | "ERROR";
  statusCode: number;
  message?: string;
  error?: string;
  transactionId?: string;
  appointment?: any;
  refundStatus?: "REFUNDED" | "REFUND_PENDING" | "FAILED";
}

export interface RefundClaimParams {
  paymentId: string; // Internal Payment id, razorpayPaymentId, or razorpayOrderId
  providerPaymentId?: string;
  reason: string;
  initiatedBy?: "PATIENT" | "DOCTOR" | "SYSTEM" | "ADMIN";
  idempotencyKey?: string;
  amount?: number;
}

export interface RefundClaimResult {
  success: boolean;
  status: "REFUNDED" | "REFUND_PENDING" | "FAILED";
  refundId?: string;
  message?: string;
  error?: string;
  pendingReconciliation?: boolean;
}

/**
 * Creates or reuses a payment order idempotently.
 * Bounds duplicate requests and prevents multiple orders for the same booking attempt.
 */
export async function createOrReusePaymentOrder(params: CreateOrderParams): Promise<{
  ok: boolean;
  order: Payment;
  keyId: string;
  reused?: boolean;
}> {
  const { userId, patientId, doctorId, slotId, holdToken, idempotencyKey } = params;

  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
    throw new Error("A valid idempotencyKey (between 8 and 128 characters) is required");
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  if (!keyId || !process.env.RAZORPAY_KEY_SECRET) {
    throw new Error("Razorpay credentials missing");
  }

  // 1. Check if order with idempotencyKey already exists
  const existingByKey = await prisma.payment.findUnique({
    where: { idempotencyKey },
    include: { appointment: true },
  });

  if (existingByKey) {
    if (
      existingByKey.userId !== userId ||
      existingByKey.doctorId !== doctorId ||
      existingByKey.slotId !== slotId
    ) {
      const err = new Error("Idempotency key has already been used with different booking details");
      (err as any).statusCode = 409;
      throw err;
    }

    if (existingByKey.status === "REFUNDED" || existingByKey.status === "REFUND_PENDING") {
      const err = new Error("Payment for this idempotency key has already been refunded or is pending refund");
      (err as any).statusCode = 409;
      throw err;
    }

    return {
      ok: true,
      order: existingByKey,
      keyId,
      reused: true,
    };
  }

  // 2. Reuse matching recent active payment attempt (within 10 minutes) for same user/slot/hold
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const matchingActivePayment = await prisma.payment.findFirst({
    where: {
      userId,
      doctorId,
      slotId,
      holdToken,
      status: "CREATED",
      createdAt: { gte: tenMinutesAgo },
    },
    orderBy: { createdAt: "desc" },
  });

  if (matchingActivePayment) {
    return {
      ok: true,
      order: matchingActivePayment,
      keyId,
      reused: true,
    };
  }

  // 3. Authoritatively validate slot hold and doctor fee
  const [doctor, slot, ownsHold] = await Promise.all([
    prisma.doctor.findUnique({ where: { id: doctorId }, select: { fees: true } }),
    prisma.slot.findFirst({
      where: { id: slotId, doctorId, status: "HELD", heldByPatientId: patientId },
      select: { id: true, startTime: true },
    }),
    validateSlotHold(slotId, patientId, holdToken),
  ]);

  if (!doctor || !slot || !ownsHold) {
    const err = new Error("Your appointment hold has expired or is invalid. Please select the slot again.");
    (err as any).statusCode = 409;
    throw err;
  }

  if (slot.startTime <= new Date()) {
    const err = new Error("Cannot book appointment for a time slot that has already passed.");
    (err as any).statusCode = 400;
    throw err;
  }

  const amountInPaise = Math.round(doctor.fees * 100);
  if (!Number.isSafeInteger(amountInPaise) || amountInPaise < 100) {
    const err = new Error("The doctor has not configured a valid consultation fee.");
    (err as any).statusCode = 400;
    throw err;
  }

  // 4. Create provider order
  const providerOrder = await createRazorpayOrder({
    amount: amountInPaise,
    currency: "INR",
    receipt: `rcpt_${idempotencyKey.slice(0, 30)}`,
    notes: {
      userId,
      doctorId,
      slotId,
      idempotencyKey,
    },
  });

  // 5. Persist payment attempt in database
  try {
    const savedOrder = await prisma.payment.create({
      data: {
        userId,
        doctorId,
        slotId,
        holdToken,
        amount: Number(providerOrder.amount),
        currency: providerOrder.currency,
        status: providerOrder.status === "created" ? "CREATED" : String(providerOrder.status).toUpperCase(),
        razorpayOrderId: providerOrder.id,
        idempotencyKey,
      },
    });

    // Ensure durable Checkout record exists with READY_FOR_PAYMENT state
    if (prisma.checkout && typeof prisma.checkout.upsert === "function") {
      await prisma.checkout.upsert({
        where: { idempotencyKey: `chk_${idempotencyKey}` },
        update: {
          paymentId: savedOrder.id,
          razorpayOrderId: providerOrder.id,
          status: "READY_FOR_PAYMENT",
        },
        create: {
          idempotencyKey: `chk_${idempotencyKey}`,
          userId,
          patientId,
          doctorId,
          slotId,
          holdToken,
          paymentMethod: "ONLINE",
          amount: Number(providerOrder.amount),
          currency: providerOrder.currency,
          status: "READY_FOR_PAYMENT",
          razorpayOrderId: providerOrder.id,
          paymentId: savedOrder.id,
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      }).catch((e) => console.warn("[createOrReusePaymentOrder] Checkout upsert warning:", e));
    }

    return {
      ok: true,
      order: savedOrder,
      keyId,
    };
  } catch (dbErr: any) {
    if (dbErr?.code === "P2002") {
      // Race collision on idempotencyKey or razorpayOrderId
      const concurrentOrder = await prisma.payment.findUnique({
        where: { idempotencyKey },
      });
      if (concurrentOrder) {
        return {
          ok: true,
          order: concurrentOrder,
          keyId,
          reused: true,
        };
      }
    }
    throw dbErr;
  }
}

/**
 * Claims and executes a refund atomically.
 * Ensures only one refund is processed per payment, supports provider idempotency,
 * and keeps refund submission, pending processing, completion, and failure distinct.
 */
export async function claimAndExecuteRefund(params: RefundClaimParams): Promise<RefundClaimResult> {
  const { paymentId, reason, initiatedBy, idempotencyKey, amount } = params;

  // 1. Locate payment
  const payment = await prisma.payment.findFirst({
    where: {
      OR: [
        { id: paymentId },
        { razorpayPaymentId: paymentId },
        { razorpayOrderId: paymentId },
      ],
    },
    include: {
      refunds: true,
    },
  });

  if (!payment) {
    return {
      success: false,
      status: "FAILED",
      error: "Payment record not found for refund",
    };
  }

  // 2. Check if already refunded
  if (payment.status === "REFUNDED") {
    const processedRefund = payment.refunds.find((r) => r.status === "PROCESSED");
    return {
      success: true,
      status: "REFUNDED",
      refundId: processedRefund?.razorpayRefundId || processedRefund?.id,
      message: "Payment has already been refunded",
    };
  }

  // 3. Check for existing refund by idempotencyKey
  const existingRefundByKey = idempotencyKey
    ? await prisma.refund.findUnique({
        where: { idempotencyKey },
      })
    : null;

  if (existingRefundByKey) {
    if (existingRefundByKey.status === "PROCESSED") {
      return {
        success: true,
        status: "REFUNDED",
        refundId: existingRefundByKey.razorpayRefundId || existingRefundByKey.id,
      };
    }
    if (existingRefundByKey.status === "PENDING") {
      return {
        success: true,
        status: "REFUND_PENDING",
        refundId: existingRefundByKey.razorpayRefundId || existingRefundByKey.id,
        message: "Refund is currently pending processing or reconciliation",
      };
    }
  }

  const refundAmount = amount ?? payment.amount;
  const refundKey = idempotencyKey || `ref_${payment.id}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  // 4. Atomically claim refund work in database
  let refundRecord: Refund;
  try {
    refundRecord = await prisma.refund.create({
      data: {
        paymentId: payment.id,
        idempotencyKey: refundKey,
        amount: refundAmount,
        currency: payment.currency,
        reason,
        status: "PENDING",
        attempts: 1,
        lastAttemptAt: new Date(),
      },
    });

    if (payment.status !== "REFUND_PENDING") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "REFUND_PENDING" },
      });
    }
  } catch (claimErr: any) {
    if (claimErr?.code === "P2002") {
      // Race: another concurrent caller claimed this refund
      const existing = await prisma.refund.findUnique({ where: { idempotencyKey: refundKey } });
      if (existing) {
        return {
          success: existing.status !== "FAILED",
          status: existing.status === "PROCESSED" ? "REFUNDED" : "REFUND_PENDING",
          refundId: existing.razorpayRefundId || existing.id,
          message: "Refund claimed by concurrent request",
        };
      }
    }
    throw claimErr;
  }

  // 5. Submit refund to provider with X-Refund-Idempotency
  // CRITICAL: Do NOT hold database transaction open across provider request!
  const providerPaymentId = params.providerPaymentId || payment.razorpayPaymentId;
  if (!providerPaymentId) {
    if (payment.status === "CREATED" || payment.status === "PENDING" || payment.status === "REFUND_PENDING") {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: "REFUNDED" },
      });
      await prisma.refund.update({
        where: { id: refundRecord.id },
        data: {
          status: "PROCESSED",
          processedAt: new Date(),
          failureReason: "Payment cancelled before capture; booking prevented",
        },
      });
      return {
        success: true,
        status: "REFUNDED",
        refundId: refundRecord.id,
        message: "Payment cancelled before capture; booking prevented",
      };
    }

    await prisma.refund.update({
      where: { id: refundRecord.id },
      data: {
        status: "FAILED",
        failureReason: "Cannot issue provider refund: missing provider payment ID",
      },
    });
    return {
      success: false,
      status: "FAILED",
      error: "Missing provider payment ID on payment record",
    };
  }

  try {
    const providerRefund = await createRazorpayRefund({
      paymentId: providerPaymentId,
      amount: refundAmount,
      idempotencyKey: refundKey,
      notes: {
        reason,
        internalPaymentId: payment.id,
        initiatedBy: initiatedBy || "SYSTEM",
      },
      receipt: `ref_${payment.id.slice(-8)}`,
    });

    if (providerRefund.status === "processed") {
      await prisma.$transaction([
        prisma.refund.update({
          where: { id: refundRecord.id },
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

      return {
        success: true,
        status: "REFUNDED",
        refundId: providerRefund.id,
      };
    } else {
      // Provider status is 'pending'
      await prisma.refund.update({
        where: { id: refundRecord.id },
        data: {
          status: "PENDING",
          razorpayRefundId: providerRefund.id,
        },
      });

      return {
        success: true,
        status: "REFUND_PENDING",
        refundId: providerRefund.id,
        message: "Refund initiated with provider; awaiting settlement confirmation",
      };
    }
  } catch (providerError: any) {
    const errorMessage = providerError instanceof Error ? providerError.message : String(providerError);
    console.error(`[claimAndExecuteRefund] Provider error for payment ${payment.id}:`, errorMessage);

    const isTimeout =
      errorMessage.toLowerCase().includes("timeout") ||
      errorMessage.toLowerCase().includes("abort") ||
      errorMessage.toLowerCase().includes("econnreset");

    if (isTimeout) {
      await prisma.refund.update({
        where: { id: refundRecord.id },
        data: {
          failureReason: `Provider request timed out: ${errorMessage}. Scheduled for reconciliation.`,
        },
      });

      return {
        success: true,
        status: "REFUND_PENDING",
        message: "Provider refund request timed out. Awaiting automated reconciliation.",
        pendingReconciliation: true,
      };
    }

    // Check if provider error says already refunded
    if (
      errorMessage.toLowerCase().includes("already refunded") ||
      errorMessage.toLowerCase().includes("payment has been fully refunded")
    ) {
      try {
        const pmt = await fetchRazorpayPayment(providerPaymentId);
        if (pmt.amount_refunded >= refundAmount || pmt.refund_status === "full") {
          await prisma.$transaction([
            prisma.refund.update({
              where: { id: refundRecord.id },
              data: {
                status: "PROCESSED",
                processedAt: new Date(),
                failureReason: "Reconciled with provider status",
              },
            }),
            prisma.payment.update({
              where: { id: payment.id },
              data: { status: "REFUNDED" },
            }),
          ]);

          return {
            success: true,
            status: "REFUNDED",
            message: "Reconciled with provider as completed",
          };
        }
      } catch {
        // Fall through to failure update
      }
    }

    // Provider rejected refund
    await prisma.refund.update({
      where: { id: refundRecord.id },
      data: {
        status: "FAILED",
        failureReason: errorMessage,
      },
    });

    return {
      success: false,
      status: "FAILED",
      error: errorMessage,
    };
  }
}

/**
 * Shared, server-authoritative payment transition service.
 * Used by both browser checkout verification and webhook delivery.
 * Guarantees that browser verification and webhook racing create exactly one booking
 * and one financial outcome.
 */
export async function verifyAndTransitionPayment(
  params: VerifyPaymentParams
): Promise<PaymentTransitionResult> {
  const { orderId, paymentId, signature, patientUserId, source } = params;

  // 1. If checkout source with client signature, verify HMAC first
  if (source === "CHECKOUT" && signature) {
    const isValidSignature = verifyCheckoutSignature({
      orderId,
      paymentId,
      signature,
    });

    if (!isValidSignature) {
      return {
        success: false,
        status: "ERROR",
        statusCode: 400,
        error: "Invalid signature",
      };
    }
  }

  // 2. Locate stored payment order
  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId: orderId },
    include: {
      appointment: true,
      refunds: true,
    },
  });

  if (!payment) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 404,
      error: "Payment order not found",
    };
  }

  // 3. User authorization check for patient checkout
  if (patientUserId && payment.userId !== patientUserId) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 403,
      error: "Authentication required: payment order does not belong to user",
    };
  }

  // 4. Terminal and idempotent state guards
  if (payment.status === "REFUNDED") {
    return {
      success: false,
      status: "REFUNDED",
      statusCode: 409,
      error: "PAYMENT_ALREADY_REFUNDED",
      message: "This payment has already been refunded.",
      transactionId: payment.razorpayPaymentId || paymentId,
      refundStatus: "REFUNDED",
    };
  }

  if (payment.status === "REFUND_PENDING") {
    return {
      success: false,
      status: "REFUND_PENDING",
      statusCode: 409,
      error: "REFUND_PENDING",
      message: "A refund is currently pending for this payment.",
      transactionId: payment.razorpayPaymentId || paymentId,
      refundStatus: "REFUND_PENDING",
    };
  }

  if (payment.status === "SUCCESS") {
    // If appointment is already linked or created
    let existingAppointment =
      payment.appointment ||
      (await prisma.appointment.findFirst({
        where: {
          OR: [{ paymentId: payment.id }, { transactionId: paymentId }],
        },
      }));

    if (!existingAppointment) {
      // If payment was already set to SUCCESS, wait briefly for concurrent appointment creation to finish
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        existingAppointment = await prisma.appointment.findFirst({
          where: {
            OR: [{ paymentId: payment.id }, { transactionId: paymentId }],
          },
        });
        if (existingAppointment) break;
      }
    }

    if (existingAppointment) {
      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified and appointment confirmed",
        transactionId: payment.razorpayPaymentId || paymentId,
        appointment: existingAppointment,
      };
    }
  }

  // 5. Authoritative provider lookup
  let providerPayment: RazorpayPaymentDetails;
  try {
    providerPayment = await fetchRazorpayPayment(paymentId, 10000, orderId);
  } catch (fetchErr: any) {
    console.error(`[verifyAndTransitionPayment] Provider payment fetch failed for ${paymentId}:`, fetchErr);
    return {
      success: false,
      status: "ERROR",
      statusCode: 502,
      error: "Failed to communicate with payment provider. Please retry.",
    };
  }

  // 6. Provider invariants validation
  if (providerPayment.order_id !== orderId) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: "Payment is not associated with this order ID",
    };
  }

  if (Number(providerPayment.amount) !== payment.amount) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: `Payment amount mismatch: expected ${payment.amount} paise, received ${providerPayment.amount} paise`,
    };
  }

  if (providerPayment.currency !== payment.currency) {
    return {
      success: false,
      status: "ERROR",
      statusCode: 400,
      error: `Payment currency mismatch: expected ${payment.currency}, received ${providerPayment.currency}`,
    };
  }

  // 7. Check provider capture status
  if (providerPayment.status === "failed") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "FAILED", razorpayPaymentId: paymentId },
    });
    return {
      success: false,
      status: "FAILED",
      statusCode: 400,
      error: providerPayment.error_description || "Payment was failed by provider",
    };
  }

  if (providerPayment.status === "refunded") {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: "REFUNDED", razorpayPaymentId: paymentId },
    });
    return {
      success: false,
      status: "REFUNDED",
      statusCode: 409,
      error: "Payment was refunded by provider",
      refundStatus: "REFUNDED",
    };
  }

  if (providerPayment.status === "authorized" && !providerPayment.captured) {
    if (payment.razorpayPaymentId !== paymentId) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: { razorpayPaymentId: paymentId },
      });
    }
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

  // 8. Atomically transition payment state to SUCCESS
  const capturedAt = new Date(providerPayment.created_at * 1000 || Date.now());
  let transitionedCount = 1;
  if (typeof prisma.payment.updateMany === "function") {
    const transitionedPayment = await prisma.payment.updateMany({
      where: {
        id: payment.id,
        status: { in: ["CREATED", "PENDING", "created", "pending"] },
      },
      data: {
        status: "SUCCESS",
        razorpayPaymentId: paymentId,
        capturedAt,
      },
    });
    transitionedCount = transitionedPayment.count;
  } else {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: "SUCCESS",
        razorpayPaymentId: paymentId,
        capturedAt,
      },
    });
  }

  // 9. Coordinate booking finalization with race protection
  if (transitionedCount === 0) {
    // Another concurrent request (browser verification or webhook) already transitioned this payment
    let concurrentAppointment = await prisma.appointment.findFirst({
      where: {
        OR: [{ paymentId: payment.id }, { transactionId: paymentId }],
      },
    });

    if (!concurrentAppointment) {
      // Wait briefly for the concurrent winning request to finish appointment insertion
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        concurrentAppointment = await prisma.appointment.findFirst({
          where: {
            OR: [{ paymentId: payment.id }, { transactionId: paymentId }],
          },
        });
        if (concurrentAppointment) break;
      }
    }

    if (concurrentAppointment) {
      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified and appointment confirmed",
        transactionId: paymentId,
        appointment: concurrentAppointment,
      };
    }

    const latestPmt = await prisma.payment.findUnique({ where: { id: payment.id } });
    if (latestPmt?.status === "SUCCESS") {
      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified",
        transactionId: paymentId,
      };
    }
  }

  // 10. Finalize appointment booking
  if (!payment.doctorId || !payment.slotId || !payment.holdToken) {
    // Missing booking context -> must refund
    const refundRes = await claimAndExecuteRefund({
      paymentId: payment.id,
      reason: "Missing booking context on payment order",
      initiatedBy: "SYSTEM",
      idempotencyKey: `auto_refund_ctx_${payment.id}`,
      amount: payment.amount,
    });

    return {
      success: false,
      status: "SLOT_UNAVAILABLE_REFUNDED",
      statusCode: 409,
      error: "SLOT_UNAVAILABLE_REFUNDED",
      message: "Payment order is missing required booking context. Payment has been refunded.",
      refundStatus: refundRes.status,
      transactionId: paymentId,
    };
  }

  const patient = await prisma.patient.findUnique({
    where: { userId: payment.userId },
  });

  if (!patient) {
    const refundRes = await claimAndExecuteRefund({
      paymentId: payment.id,
      reason: "Patient record not found",
      initiatedBy: "SYSTEM",
      idempotencyKey: `auto_refund_patient_${payment.id}`,
      amount: payment.amount,
    });

    return {
      success: false,
      status: "SLOT_UNAVAILABLE_REFUNDED",
      statusCode: 409,
      error: "SLOT_UNAVAILABLE_REFUNDED",
      message: "Patient profile not found. Payment has been refunded.",
      refundStatus: refundRes.status,
      transactionId: paymentId,
    };
  }

  const appointment = await finalizeAppointmentBooking({
    slotId: payment.slotId,
    doctorId: payment.doctorId,
    patientId: patient.id,
    patientUserId: payment.userId,
    holdToken: payment.holdToken,
    paymentMethod: "ONLINE",
    transactionId: paymentId,
    paymentId: payment.id,
  });

  if (!appointment) {
    // Check if a concurrent request (e.g. webhook vs browser verification) just finalized the appointment
    let concurrentAppointment = await prisma.appointment.findFirst({
      where: {
        OR: [{ paymentId: payment.id }, { transactionId: paymentId }],
      },
    });

    if (!concurrentAppointment) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        concurrentAppointment = await prisma.appointment.findFirst({
          where: {
            OR: [{ paymentId: payment.id }, { transactionId: paymentId }],
          },
        });
        if (concurrentAppointment) break;
      }
    }

    if (concurrentAppointment) {
      return {
        success: true,
        status: "SUCCESS",
        statusCode: 200,
        message: "Payment verified and appointment confirmed",
        transactionId: paymentId,
        appointment: concurrentAppointment,
      };
    }

    console.error(
      `[verifyAndTransitionPayment] Appointment finalization failed for payment ${payment.id}. Executing automatic refund compensation.`,
      { orderId, paymentId, slotId: payment.slotId }
    );

    const refundRes = await claimAndExecuteRefund({
      paymentId: payment.id,
      reason: "Automatic compensation: slot unavailable during finalization",
      initiatedBy: "SYSTEM",
      idempotencyKey: `auto_refund_slot_${payment.id}`,
      amount: payment.amount,
    });

    if (prisma.checkout && typeof prisma.checkout.updateMany === "function") {
      await prisma.checkout.updateMany({
        where: {
          OR: [
            { paymentId: payment.id },
            { razorpayOrderId: orderId },
          ],
        },
        data: {
          status: "EXPIRED",
        },
      }).catch(() => undefined);
    }

    return {
      success: false,
      status: "SLOT_UNAVAILABLE_REFUNDED",
      statusCode: 409,
      error: "SLOT_UNAVAILABLE_REFUNDED",
      message: "The requested slot is no longer available. Your payment has been automatically refunded.",
      refundStatus: refundRes.status,
      transactionId: paymentId,
    };
  }

  if (prisma.checkout && typeof prisma.checkout.updateMany === "function") {
    await prisma.checkout.updateMany({
      where: {
        OR: [
          { paymentId: payment.id },
          { razorpayOrderId: orderId },
        ],
      },
      data: {
        status: "CONFIRMED",
        appointmentId: appointment.id,
        confirmedAt: new Date(),
      },
    }).catch(() => undefined);
  }

  return {
    success: true,
    status: "SUCCESS",
    statusCode: 200,
    message: "Payment verified and appointment confirmed",
    transactionId: paymentId,
    appointment,
  };
}

/**
 * Returns authoritative payment, appointment, and refund status for an order.
 */
export async function getAuthoritativePaymentStatus(orderId: string, userId: string) {
  const payment = await prisma.payment.findUnique({
    where: { razorpayOrderId: orderId },
    include: {
      appointment: {
        include: {
          slot: true,
          doctor: {
            include: { user: { select: { name: true, email: true } } },
          },
        },
      },
      refunds: {
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!payment || payment.userId !== userId) {
    return null;
  }

  const latestRefund = payment.refunds[0] || null;

  return {
    orderId: payment.razorpayOrderId,
    paymentId: payment.razorpayPaymentId,
    amount: payment.amount,
    currency: payment.currency,
    status: payment.status,
    capturedAt: payment.capturedAt,
    appointment: payment.appointment
      ? {
          id: payment.appointment.id,
          status: payment.appointment.status,
          slotId: payment.appointment.slotId,
          slotDate: payment.appointment.slot.date,
          slotStartTime: payment.appointment.slot.startTime,
          doctorName: payment.appointment.doctor.user.name,
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
  };
}
