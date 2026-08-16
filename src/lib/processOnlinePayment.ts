// 1. Helper function to load the script dynamically

const loadRazorpayScript = (src: string) => {
  return new Promise((resolve) => {
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
  slotId,
  userId,
  userEmail,
  userName,
  userPhone,
}: {
  doctorId: string;
  slotId: string;
  userId: string;
  userEmail?: string;
  userName?: string;
  userPhone?: string;
}) {
  return new Promise<{ success: boolean; transactionId: string | null; error?: string }>(async (resolve) => {
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
        body: JSON.stringify({ doctorId, slotId }),
      });
      
      const data = await orderRes.json();
      if (!orderRes.ok) throw new Error(data.message || "Failed to create payment order");

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
        handler: async function (response: any) {
          try {
            // 5. Verify Payment on Server
            const verifyRes = await fetch(`/api/user/${userId}/payments/verifyOrder`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                orderId: response.razorpay_order_id,
                paymentId: response.razorpay_payment_id,
                signature: response.razorpay_signature,
              }),
            });
            
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) throw new Error(verifyData.error || "Payment verification failed");

            resolve({ success: true, transactionId: response.razorpay_payment_id });
          } catch (err: any) {
            resolve({ success: false, error: "Verification Failed: " + err.message, transactionId: null });
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
      const rzp1 = new (window as any).Razorpay(options);
      
      rzp1.on('payment.failed', function (response: any) {
        resolve({ success: false, error: response?.error?.description || "Payment failed", transactionId: null });
      });

      rzp1.open();

    } catch (err: any) {
      console.error("Payment Error:", err);
      resolve({ success: false, error: err.message, transactionId: null });
    }
  });
}
