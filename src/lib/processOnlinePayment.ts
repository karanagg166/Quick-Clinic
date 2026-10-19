// src/lib/processOnlinePayment.ts

export type CheckoutState =
  | 'IDLE'
  | 'LOADING_SDK'
  | 'CREATING_ORDER'
  | 'AWAITING_PAYMENT'
  | 'CONFIRMING'
  | 'BOOKED'
  | 'PAYMENT_RECEIVED_BOOKING_PENDING'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'FAILED';

export interface ProcessPaymentResult {
  success: boolean;
  state: CheckoutState;
  transactionId: string | null;
  orderId?: string | null;
  appointmentId?: string;
  amount?: number;
  currency?: string;
  refundStatus?: 'REFUNDED' | 'REFUND_PENDING' | 'FAILED';
  error?: string;
  message?: string;
  paymentCaptured?: boolean;
}

let sdkLoadPromise: Promise<boolean> | null = null;
let isCheckoutActive = false;

/**
 * Loads Razorpay SDK script using a shared singleton promise.
 * Avoids false positives from existing incomplete script tags.
 */
export function loadRazorpaySDK(): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<boolean>((resolve) => {
    const src = 'https://checkout.razorpay.com/v1/checkout.js';
    let script = document.querySelector(`script[src="${src}"]`) as HTMLScriptElement | null;

    if (!script) {
      script = document.createElement('script');
      script.src = src;
      script.async = true;
      document.body.appendChild(script);
    }

    if (window.Razorpay) {
      resolve(true);
      return;
    }

    const handleLoad = () => {
      resolve(Boolean(window.Razorpay));
    };

    const handleError = () => {
      sdkLoadPromise = null; // Allow retry on failure
      resolve(false);
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
  });

  return sdkLoadPromise;
}

/**
 * Polls the authenticated payment status endpoint for server-side confirmation.
 * Used when verification encounters a network timeout or uncertainty.
 */
export async function pollPaymentStatus(
  userId: string,
  orderId: string,
  maxAttempts = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 1 : 5,
  intervalMs = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 10 : 2000
): Promise<any | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`/api/user/${userId}/payments/${orderId}/status`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          const appt = data.appointment || (typeof data.status === 'object' && data.status?.appointment);
          const paymentStatusObj = data.paymentStatus || (typeof data.status === 'object' ? data.status : null);
          const statusStr = typeof data.status === 'string' ? data.status : paymentStatusObj?.status;

          if (appt) {
            return { state: 'BOOKED', status: paymentStatusObj || { ...data, appointment: appt } };
          }
          if (statusStr === 'REFUNDED') {
            return { state: 'REFUNDED', status: paymentStatusObj || data };
          }
          if (statusStr === 'REFUND_PENDING') {
            return { state: 'REFUND_PENDING', status: paymentStatusObj || data };
          }
          if (statusStr === 'FAILED') {
            return { state: 'FAILED', status: paymentStatusObj || data };
          }
        }
      }
    } catch {
      // transient network error, retry
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export async function processOnlinePayment({
  doctorId,
  holdToken,
  slotId,
  userId,
  userEmail,
  userName,
  userPhone,
  onStateChange,
}: {
  doctorId: string;
  holdToken: string;
  slotId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  userPhone?: string;
  onStateChange?: (state: CheckoutState, details?: Partial<ProcessPaymentResult>) => void;
}): Promise<ProcessPaymentResult> {
  if (isCheckoutActive) {
    return {
      success: false,
      state: 'FAILED',
      transactionId: null,
      error: 'A checkout process is already active. Please finish or close the payment window.',
    };
  }

  isCheckoutActive = true;
  const updateState = (state: CheckoutState, details?: Partial<ProcessPaymentResult>) => {
    if (onStateChange) {
      onStateChange(state, details);
    }
  };

  return new Promise<ProcessPaymentResult>(async (resolve) => {
    let currentOrderId: string | null = null;
    let paymentCaptured = false;

    const cleanupAndResolve = (result: ProcessPaymentResult) => {
      isCheckoutActive = false;
      updateState(result.state, result);
      resolve(result);
    };

    try {
      updateState('LOADING_SDK');
      const isLoaded = await loadRazorpaySDK();
      if (!isLoaded || !window.Razorpay) {
        cleanupAndResolve({
          success: false,
          state: 'FAILED',
          transactionId: null,
          error: 'Unable to load payment gateway. Please verify your internet connection and try again.',
        });
        return;
      }

      updateState('CREATING_ORDER');
      const idempotencyKey = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `ord_${userId.slice(-6)}_${slotId}_${Date.now()}`;

      const orderRes = await fetch(`/api/user/${userId}/payments/createOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ doctorId, slotId, holdToken, idempotencyKey }),
      });

      const orderData = await orderRes.json();
      if (!orderRes.ok || !orderData.keyId || !orderData.order?.razorpayOrderId) {
        cleanupAndResolve({
          success: false,
          state: 'FAILED',
          transactionId: null,
          error: orderData.message || 'Failed to initialize payment order. Your appointment hold may have expired.',
        });
        return;
      }

      currentOrderId = orderData.order.razorpayOrderId;
      const orderAmount = orderData.order.amount;
      const orderCurrency = orderData.order.currency || 'INR';

      updateState('AWAITING_PAYMENT', {
        orderId: currentOrderId,
        amount: orderAmount,
        currency: orderCurrency,
      });

      const prefillData: Record<string, string> = {};
      if (userName?.trim()) prefillData.name = userName.trim();
      if (userEmail?.trim()) prefillData.email = userEmail.trim();
      if (userPhone?.trim()) {
        const cleanPhone = userPhone.replace(/\D/g, '').slice(-10);
        if (cleanPhone.length === 10) prefillData.contact = cleanPhone;
      }

      const options = {
        key: orderData.keyId,
        amount: orderAmount,
        currency: orderCurrency,
        name: 'Quick Clinic',
        description: 'Medical Consultation Booking',
        order_id: currentOrderId!,
        prefill: Object.keys(prefillData).length > 0 ? prefillData : undefined,
        handler: async function (response: RazorpaySuccessResponse) {
          paymentCaptured = true;
          updateState('CONFIRMING', {
            transactionId: response.razorpay_payment_id,
            orderId: response.razorpay_order_id,
            amount: orderAmount,
            currency: orderCurrency,
          });

          try {
            const verifyRes = await fetch(`/api/user/${userId}/payments/verifyOrder`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            });

            const verifyData = await verifyRes.json();

            if (verifyRes.ok && verifyData.appointment) {
              cleanupAndResolve({
                success: true,
                state: 'BOOKED',
                transactionId: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                appointmentId: verifyData.appointment.id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: true,
                message: verifyData.message || 'Appointment confirmed successfully',
              });
              return;
            }

            if (verifyRes.status === 409) {
              const refundStatus = verifyData.refundStatus || 'REFUND_PENDING';
              cleanupAndResolve({
                success: false,
                state: refundStatus === 'REFUNDED' ? 'REFUNDED' : 'REFUND_PENDING',
                transactionId: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: true,
                refundStatus,
                error: verifyData.message || 'Slot was no longer available. Your payment is being refunded.',
              });
              return;
            }

            // Server returned other error - poll status endpoint to confirm true status before failing
            const polled = await pollPaymentStatus(userId, response.razorpay_order_id);
            if (polled?.state === 'BOOKED') {
              cleanupAndResolve({
                success: true,
                state: 'BOOKED',
                transactionId: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                appointmentId: polled.status.appointment.id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: true,
              });
              return;
            }

            cleanupAndResolve({
              success: false,
              state: 'PAYMENT_RECEIVED_BOOKING_PENDING',
              transactionId: response.razorpay_payment_id,
              orderId: response.razorpay_order_id,
              amount: orderAmount,
              currency: orderCurrency,
              paymentCaptured: true,
              error: 'Payment was captured but booking confirmation failed: ' + (verifyData.error || 'Booking confirmation pending'),
            });
          } catch (networkError) {
            // Network drop during verification callback: poll status endpoint
            console.warn('[processOnlinePayment] Network error verifying order, polling status...', networkError);
            const polled = await pollPaymentStatus(userId, response.razorpay_order_id);
            if (polled?.state === 'BOOKED') {
              cleanupAndResolve({
                success: true,
                state: 'BOOKED',
                transactionId: response.razorpay_payment_id,
                orderId: response.razorpay_order_id,
                appointmentId: polled.status.appointment.id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: true,
              });
              return;
            }

            cleanupAndResolve({
              success: false,
              state: 'PAYMENT_RECEIVED_BOOKING_PENDING',
              transactionId: response.razorpay_payment_id,
              orderId: response.razorpay_order_id,
              amount: orderAmount,
              currency: orderCurrency,
              paymentCaptured: true,
              error: 'Payment was captured but booking confirmation failed: Network error occurred',
            });
          }
        },
        modal: {
          ondismiss: function () {
            if (!paymentCaptured) {
              cleanupAndResolve({
                success: false,
                state: 'FAILED',
                transactionId: null,
                orderId: currentOrderId,
                amount: orderAmount,
                currency: orderCurrency,
                error: 'Payment was cancelled.',
              });
            }
          },
        },
        theme: { color: '#0d9488' },
      };

      const rzpInstance = new window.Razorpay(options);
      rzpInstance.on('payment.failed', function (errResp: RazorpayFailureResponse) {
        cleanupAndResolve({
          success: false,
          state: 'FAILED',
          transactionId: null,
          orderId: currentOrderId,
          amount: orderAmount,
          currency: orderCurrency,
          error: errResp?.error?.description || 'Payment was declined or failed.',
        });
      });

      rzpInstance.open();
    } catch (err: unknown) {
      console.error('[processOnlinePayment] Unexpected error:', err);
      cleanupAndResolve({
        success: false,
        state: 'FAILED',
        transactionId: null,
        orderId: currentOrderId,
        error: err instanceof Error ? err.message : 'Unexpected payment error occurred',
      });
    }
  });
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => {
      open: () => void;
      on: (event: 'payment.failed', callback: (response: RazorpayFailureResponse) => void) => void;
    };
  }
}

interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailureResponse {
  error?: { description?: string };
}

interface RazorpayOptions {
  key: string;
  amount?: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: Record<string, string>;
  handler: (response: RazorpaySuccessResponse) => Promise<void>;
  modal: { ondismiss: () => void };
  theme: { color: string };
}
