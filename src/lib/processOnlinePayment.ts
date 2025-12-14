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

export async function processOnlinePayment(amount: number, userId: string) {
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
        body: JSON.stringify({ amount }),
      });
      
      const data = await orderRes.json();
      if (!orderRes.ok) throw new Error(data.message);

      // 4. Initialize Razorpay Options
      const options = {
        key: data.keyId, 
        amount: data.order.amount,
        currency: "INR",
        name: "Quick Clinic",
        description: "Medical Consultation",
        order_id: data.order.razorpayOrderId, 
        
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
            if (!verifyRes.ok) throw new Error(verifyData.error);

            resolve({ success: true, transactionId: response.razorpay_payment_id });
          } catch (err: any) {
            resolve({ success: false, error: "Verification Failed: " + err.message, transactionId: null });
          }
        },
        theme: { color: "#3399cc" },
      };

      // 6. Open the Payment Window
      const rzp1 = new (window as any).Razorpay(options);
      
      rzp1.on('payment.failed', function (response: any) {
        resolve({ success: false, error: response.error.description, transactionId: null });
      });

      rzp1.open();

    } catch (err: any) {
      console.error("Payment Error:", err);
      resolve({ success: false, error: err.message, transactionId: null });
    }
  });
}