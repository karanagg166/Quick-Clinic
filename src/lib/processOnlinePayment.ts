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
  checkoutId?: string | null;
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

    const handleLoad = () => resolve(Boolean(window.Razorpay));
    const handleError = () => {
      sdkLoadPromise = null;
      resolve(false);
    };

    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
  });

  return sdkLoadPromise;
}

/**
 * Polls the checkout status endpoint for server-side confirmation.
 * Used when verification encounters a network timeout or uncertainty.
 */
export async function pollPaymentStatus(
  userId: string,
  checkoutIdOrOrderId: string,
  maxAttempts = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 1 : 5,
  intervalMs = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test' ? 10 : 2000
): Promise<any | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      let res = await fetch(`/api/checkout/${encodeURIComponent(checkoutIdOrOrderId)}/status`, {
        credentials: 'include',
      });
      if (!res.ok) {
        res = await fetch(`/api/user/${userId}/payments/${encodeURIComponent(checkoutIdOrOrderId)}/status`, {
          credentials: 'include',
        });
      }

      if (res.ok) {
        const data = await res.json();
        if (data?.ok) {
          const appt = data.appointment || (typeof data.status === 'object' && data.status?.appointment);
          const paymentStatusObj = data.paymentStatus || (typeof data.status === 'object' ? data.status : null);
          const statusStr = typeof data.status === 'string' ? data.status : paymentStatusObj?.status;
          const refundStatus =
            data.refundStatus ||
            paymentStatusObj?.refundStatus ||
            (statusStr === 'REFUNDED' ? 'REFUNDED' : statusStr === 'REFUND_PENDING' ? 'REFUND_PENDING' : null);

          // Require a canonical appointment record before declaring BOOKED
          if (appt && (appt.id || statusStr === 'CONFIRMED')) {
            return { state: 'BOOKED', status: paymentStatusObj || { ...data, appointment: appt } };
          }
          if (refundStatus === 'REFUNDED' || statusStr === 'REFUNDED') {
            return { state: 'REFUNDED', refundStatus: 'REFUNDED', status: paymentStatusObj || data };
          }
          if (refundStatus === 'REFUND_PENDING' || statusStr === 'REFUND_PENDING') {
            return { state: 'REFUND_PENDING', refundStatus: 'REFUND_PENDING', status: paymentStatusObj || data };
          }
          if (refundStatus === 'FAILED') {
            return { state: 'FAILED', refundStatus: 'FAILED', status: paymentStatusObj || data };
          }
          if (statusStr === 'FAILED' || statusStr === 'EXPIRED') {
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

export interface ProcessOnlinePaymentParams {
  doctorId: string;
  slotId: string;
  userId: string;
  idempotencyKey?: string;
  holdToken?: string;
  userEmail?: string;
  userName?: string;
  userPhone?: string;
  onStateChange?: (state: CheckoutState, details?: Partial<ProcessPaymentResult>) => void;
}

export async function processOnlinePayment({
  doctorId,
  slotId,
  userId,
  idempotencyKey,
  holdToken,
  userEmail,
  userName,
  userPhone,
  onStateChange,
}: ProcessOnlinePaymentParams): Promise<ProcessPaymentResult> {
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
    if (onStateChange) onStateChange(state, details);
  };

  return new Promise<ProcessPaymentResult>(async (resolve) => {
    let activeCheckoutId: string | null = null;
    let currentOrderId: string | null = null;
    let paymentSubmitted = false;

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
      const clientKey =
        idempotencyKey ||
        (typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `ord_${userId.slice(-6)}_${slotId}_${Date.now()}`);

      let initRes = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'INITIATE',
          doctorId,
          slotId,
          paymentMethod: 'ONLINE',
          idempotencyKey: clientKey,
        }),
      });

      let orderData: any = null;
      if (initRes.ok) {
        orderData = await initRes.json();
      } else {
        const errorData = await initRes.json().catch(() => ({}));
        if (initRes.status === 404 && holdToken) {
          initRes = await fetch(`/api/user/${userId}/payments/createOrder`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ doctorId, slotId, holdToken, idempotencyKey: clientKey }),
          });
          orderData = await initRes.json().catch(() => ({}));
        } else {
          cleanupAndResolve({
            success: false,
            state: 'FAILED',
            transactionId: null,
            error: errorData.error || errorData.message || 'Failed to initialize payment order. Slot may no longer be available.',
          });
          return;
        }
      }

      activeCheckoutId = orderData.checkoutId || null;
      currentOrderId = orderData.orderId || orderData.order?.razorpayOrderId || null;
      const orderAmount = orderData.amount || orderData.order?.amount;
      const orderCurrency = orderData.currency || orderData.order?.currency || 'INR';
      const keyId = orderData.keyId;

      if (orderData.ok === false) {
        if (orderData.status === 'PENDING_ORDER' || orderData.canRetry) {
          cleanupAndResolve({
            success: false,
            state: 'CREATING_ORDER',
            transactionId: null,
            checkoutId: activeCheckoutId,
            error: orderData.message || 'Payment order initialization is in progress. Please retry in a moment.',
          });
          return;
        }
        if (orderData.status === 'EXPIRED' || orderData.canRestart) {
          cleanupAndResolve({
            success: false,
            state: 'FAILED',
            transactionId: null,
            checkoutId: activeCheckoutId,
            error: orderData.error || 'Checkout reservation has expired. Please select a time slot to restart.',
          });
          return;
        }
        cleanupAndResolve({
          success: false,
          state: 'FAILED',
          transactionId: null,
          checkoutId: activeCheckoutId,
          error: orderData.error || orderData.message || 'Unable to start checkout.',
        });
        return;
      }

      if (!currentOrderId || !keyId) {
        cleanupAndResolve({
          success: false,
          state: 'FAILED',
          transactionId: null,
          checkoutId: activeCheckoutId,
          error: orderData.message || orderData.error || 'Invalid gateway order response received.',
        });
        return;
      }

      updateState('AWAITING_PAYMENT', {
        checkoutId: activeCheckoutId,
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

      const options: RazorpayOptions = {
        key: keyId,
        amount: orderAmount,
        currency: orderCurrency,
        name: 'Quick Clinic',
        description: 'Medical Consultation Booking',
        order_id: currentOrderId,
        prefill: Object.keys(prefillData).length > 0 ? prefillData : undefined,
        handler: async function (response: RazorpaySuccessResponse) {
          // Razorpay modal callback invoked; payment is submitted to server for authoritative verification
          paymentSubmitted = true;
          updateState('CONFIRMING', {
            transactionId: response.razorpay_payment_id,
            checkoutId: activeCheckoutId,
            orderId: response.razorpay_order_id,
            amount: orderAmount,
            currency: orderCurrency,
          });

          try {
            let verifyRes = await fetch('/api/checkout', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                action: 'VERIFY',
                checkoutId: activeCheckoutId || undefined,
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            });

            let verifyData = await verifyRes.json().catch(() => ({}));

            if (!verifyRes.ok && verifyRes.status === 404) {
              verifyRes = await fetch(`/api/user/${userId}/payments/verifyOrder`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({
                  orderId: response.razorpay_order_id,
                  paymentId: response.razorpay_payment_id,
                  signature: response.razorpay_signature,
                }),
              });
              verifyData = await verifyRes.json().catch(() => ({}));
            }

            if (verifyRes.ok && verifyData.appointment) {
              cleanupAndResolve({
                success: true,
                state: 'BOOKED',
                transactionId: response.razorpay_payment_id,
                checkoutId: activeCheckoutId,
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
              const refundStatus = verifyData.refundStatus;
              if (refundStatus === 'REFUNDED') {
                cleanupAndResolve({
                  success: false,
                  state: 'REFUNDED',
                  transactionId: response.razorpay_payment_id,
                  checkoutId: activeCheckoutId,
                  orderId: response.razorpay_order_id,
                  amount: orderAmount,
                  currency: orderCurrency,
                  paymentCaptured: true,
                  refundStatus: 'REFUNDED',
                  error: verifyData.message || 'Reservation expired. Your payment has been refunded.',
                });
                return;
              }
              if (refundStatus === 'REFUND_PENDING') {
                cleanupAndResolve({
                  success: false,
                  state: 'REFUND_PENDING',
                  transactionId: response.razorpay_payment_id,
                  checkoutId: activeCheckoutId,
                  orderId: response.razorpay_order_id,
                  amount: orderAmount,
                  currency: orderCurrency,
                  paymentCaptured: true,
                  refundStatus: 'REFUND_PENDING',
                  error: verifyData.message || 'Reservation expired. A refund has been initiated and is pending.',
                });
                return;
              }
              cleanupAndResolve({
                success: false,
                state: 'FAILED',
                transactionId: response.razorpay_payment_id,
                checkoutId: activeCheckoutId,
                orderId: response.razorpay_order_id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: refundStatus === 'FAILED',
                refundStatus: refundStatus === 'FAILED' ? 'FAILED' : undefined,
                error: verifyData.message || verifyData.error || 'The slot reservation expired. Please select a time slot again.',
              });
              return;
            }

            const polled = await pollPaymentStatus(userId, activeCheckoutId || response.razorpay_order_id);
            if (polled?.state === 'BOOKED') {
              cleanupAndResolve({
                success: true,
                state: 'BOOKED',
                transactionId: response.razorpay_payment_id,
                checkoutId: activeCheckoutId,
                orderId: response.razorpay_order_id,
                appointmentId: polled.status.appointment?.id || polled.status.id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: true,
              });
              return;
            }
            if (polled?.state === 'REFUNDED') {
              cleanupAndResolve({
                success: false,
                state: 'REFUNDED',
                transactionId: response.razorpay_payment_id,
                checkoutId: activeCheckoutId,
                orderId: response.razorpay_order_id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: true,
                refundStatus: 'REFUNDED',
                error: 'Reservation expired. Your payment has been refunded.',
              });
              return;
            }
            if (polled?.state === 'REFUND_PENDING') {
              cleanupAndResolve({
                success: false,
                state: 'REFUND_PENDING',
                transactionId: response.razorpay_payment_id,
                checkoutId: activeCheckoutId,
                orderId: response.razorpay_order_id,
                amount: orderAmount,
                currency: orderCurrency,
                paymentCaptured: true,
                refundStatus: 'REFUND_PENDING',
                error: 'Reservation expired. A refund has been initiated and is pending.',
              });
              return;
            }

            cleanupAndResolve({
              success: false,
              state: 'PAYMENT_RECEIVED_BOOKING_PENDING',
              transactionId: response.razorpay_payment_id,
              checkoutId: activeCheckoutId,
              orderId: response.razorpay_order_id,
              amount: orderAmount,
              currency: orderCurrency,
              paymentCaptured: true,
              error: 'Payment was captured but booking confirmation is pending. Please check dashboard.',
            });
          } catch (networkError) {
            console.warn('[processOnlinePayment] Network error verifying order, polling status...', networkError);
            const polled = await pollPaymentStatus(userId, activeCheckoutId || response.razorpay_order_id);
            if (polled?.state === 'BOOKED') {
              cleanupAndResolve({
                success: true,
                state: 'BOOKED',
                transactionId: response.razorpay_payment_id,
                checkoutId: activeCheckoutId,
                orderId: response.razorpay_order_id,
                appointmentId: polled.status.appointment?.id || polled.status.id,
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
              checkoutId: activeCheckoutId,
              orderId: response.razorpay_order_id,
              amount: orderAmount,
              currency: orderCurrency,
              paymentCaptured: true,
              error: 'Payment authorized but verification network failed. Confirmation is finalizing.',
            });
          }
        },
        modal: {
          ondismiss: function () {
            if (!paymentSubmitted) {
              cleanupAndResolve({
                success: false,
                state: 'FAILED',
                transactionId: null,
                checkoutId: activeCheckoutId,
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
          checkoutId: activeCheckoutId,
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
        checkoutId: activeCheckoutId,
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
