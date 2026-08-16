// 1. Helper function to load the script dynamically

const loadRazorpayScript = (src: string) => {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && window.Razorpay) {
      resolve(true);
      return;
    }
    if (document.querySelector(`script[src="${src}"]`)) {
        resolve(true); // Script already loaded
        return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
};

export async function processOnlinePayment({
  doctorId,
  holdToken,
  slotId,
  userId,
  userEmail,
  userName,
  userPhone,
}: {
  doctorId: string;
  holdToken: string;
  slotId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  userPhone?: string;
}) {
  return new Promise<{
    success: boolean;
    transactionId: string | null;
    appointmentId?: string;
    paymentCaptured?: boolean;
    error?: string;
  }>(async (resolve) => {
    try {
      // 2. Load the Razorpay SDK Script explicitly
      const isScriptLoaded = await loadRazorpayScript("https://checkout.razorpay.com/v1/checkout.js");

      if (!isScriptLoaded) {
        throw new Error("Razorpay SDK failed to load. Are you online?");
      }

      // 3. Create order on your server
      const orderRes = await fetch(`/api/user/${userId}/payments/createOrder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ doctorId, slotId, holdToken }),
      });
      
      const data = await orderRes.json() as CreateOrderResponse;
      if (!orderRes.ok) throw new Error(data.message || "Failed to create payment order");
      if (!data.keyId || !data.order?.razorpayOrderId) {
        throw new Error('Payment provider returned an invalid order. Please try again.');
      }

      // 4. Initialize Razorpay Options
      const prefillData: Record<string, string> = {};
      if (userName && userName.trim()) prefillData.name = userName.trim();
      if (userEmail && userEmail.trim()) prefillData.email = userEmail.trim();
      if (userPhone && userPhone.trim()) {
        const cleanPhone = userPhone.replace(/\D/g, '').slice(-10);
        if (cleanPhone.length === 10) prefillData.contact = cleanPhone;
      }

      const options = {
        key: data.keyId,
        amount: data.order?.amount,
        currency: data.order?.currency || "INR",
        name: "Quick Clinic",
        description: "Medical Consultation Booking",
        order_id: data.order?.razorpayOrderId,
        prefill: Object.keys(prefillData).length > 0 ? prefillData : undefined,
        handler: async function (response: RazorpaySuccessResponse) {
          try {
            // 5. Verify Payment on Server
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
            
            const verifyData = await verifyRes.json() as VerifyOrderResponse;
            if (!verifyRes.ok) throw new Error(verifyData.error || "Payment verification failed");

            resolve({
              success: true,
              transactionId: response.razorpay_payment_id,
              appointmentId: verifyData.appointment?.id,
              paymentCaptured: true,
            });
          } catch (error: unknown) {
            resolve({
              success: false,
              error: "Payment was captured but booking confirmation failed: " + getErrorMessage(error),
              transactionId: response.razorpay_payment_id,
              paymentCaptured: true,
            });
          }
        },
        modal: {
          ondismiss: function () {
            resolve({ success: false, error: "Payment was cancelled.", transactionId: null });
          },
        },
        theme: { color: "#0d9488" },
      };

      // 6. Open the Payment Window
      if (!window.Razorpay) throw new Error('Razorpay SDK is unavailable. Please reload and try again.');
      const rzp1 = new window.Razorpay(options);
      
      rzp1.on('payment.failed', function (response: RazorpayFailureResponse) {
        resolve({ success: false, error: response?.error?.description || "Payment failed", transactionId: null });
      });

      rzp1.open();

    } catch (error: unknown) {
      console.error("Payment Error:", error);
      resolve({ success: false, error: getErrorMessage(error), transactionId: null });
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

type RazorpaySuccessResponse = {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

type RazorpayFailureResponse = {
  error?: { description?: string };
};

type RazorpayOptions = {
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
};

type CreateOrderResponse = {
  message?: string;
  keyId: string;
  order?: { amount?: number; currency?: string; razorpayOrderId?: string };
};

type VerifyOrderResponse = {
  error?: string;
  appointment?: { id?: string };
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected payment error';
}
