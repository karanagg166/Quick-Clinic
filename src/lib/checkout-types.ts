import { z } from "zod";
import type { CheckoutStatus, PaymentMethod } from "@/generated/prisma";

export const checkoutInitiateSchema = z.object({
  action: z.literal("INITIATE"),
  doctorId: z.string().min(1, "doctorId is required"),
  slotId: z.string().min(1, "slotId is required"),
  paymentMethod: z.enum(["ONLINE", "OFFLINE"]),
  idempotencyKey: z.string().min(8, "idempotencyKey must be at least 8 characters").max(128),
});

export const checkoutVerifySchema = z.object({
  action: z.literal("VERIFY"),
  checkoutId: z.string().min(1).optional(),
  orderId: z.string().min(1).optional(),
  paymentId: z.string().min(1, "paymentId is required"),
  signature: z.string().regex(/^[a-f0-9]{64}$/i, "Valid signature required"),
});

export const checkoutRequestSchema = z.discriminatedUnion("action", [
  checkoutInitiateSchema,
  checkoutVerifySchema,
]);

export type CheckoutInitiateInput = z.infer<typeof checkoutInitiateSchema>;
export type CheckoutVerifyInput = z.infer<typeof checkoutVerifySchema>;
export type CheckoutRequestInput = z.infer<typeof checkoutRequestSchema>;

export type CheckoutResultCode =
  | "SUCCESS"
  | "RESERVATION_CONFLICT"
  | "VALIDATION_ERROR"
  | "CAPTURE_PENDING"
  | "CONFIRMATION_PENDING"
  | "REFUND_PENDING"
  | "REFUNDED"
  | "FAILED"
  | "EXPIRED";

export type CheckoutNextAction =
  | "NONE"
  | "RETRY_VERIFY"
  | "RESTART_CHECKOUT"
  | "CONTACT_SUPPORT"
  | "REDIRECT_DASHBOARD"
  | "WAIT_RETRY";

export interface InitiateCheckoutParams {
  userId: string;
  patientId: string;
  doctorId: string;
  slotId: string;
  paymentMethod: "ONLINE" | "OFFLINE";
  idempotencyKey: string;
}

export interface InitiateCheckoutResult {
  ok: boolean;
  checkoutId: string;
  status: CheckoutStatus;
  paymentMethod: PaymentMethod;
  amount: number;
  currency: string;
  expiresAt: string;
  orderId?: string | null;
  keyId?: string;
  reused?: boolean;
  appointment?: any;
  canRetry?: boolean;
  canRestart?: boolean;
  error?: string;
  message?: string;
  resultCode?: CheckoutResultCode;
  nextAction?: CheckoutNextAction;
}

export interface VerifyCheckoutParams {
  userId: string;
  patientId?: string;
  checkoutId?: string;
  orderId?: string;
  paymentId: string;
  signature?: string;
  source: "CHECKOUT" | "WEBHOOK" | "RECONCILIATION";
}

export interface VerifyCheckoutResult {
  success: boolean;
  status: "SUCCESS" | "REFUNDED" | "REFUND_PENDING" | "FAILED" | "PENDING_CAPTURE" | "SLOT_UNAVAILABLE_REFUNDED" | "ERROR";
  statusCode: number;
  message?: string;
  error?: string;
  transactionId?: string;
  appointment?: any;
  refundStatus?: "REFUNDED" | "REFUND_PENDING" | "FAILED";
  resultCode?: CheckoutResultCode;
  nextAction?: CheckoutNextAction;
}
