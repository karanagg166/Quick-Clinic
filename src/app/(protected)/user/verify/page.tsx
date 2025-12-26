"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store";
import { SendOtpForm } from "@/components/general/sendOtp";
import { VerifyOtpForm } from "@/components/general/verifyOtp";
import { showToast } from "@/lib/toast";

export default function VerifyPage() {
  
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);



  const user = useUserStore((state) => state.user);
  const updateUser = useUserStore((state) => state.updateUser);

  const email = user?.email || "";

  const userId = user?.id;
  const verified = user?.emailVerified;

  /* -------------------------------
     ALERT IF ALREADY VERIFIED
  --------------------------------*/
  useEffect(() => {
    if (verified) {
      showToast.info("Your account is already verified.");
    }
  }, [verified]);

  /* -------------------------------
     VERIFIED STATE UI
  --------------------------------*/
  if (verified) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-4">
        <div className="bg-card rounded-lg border shadow-sm p-8 text-center max-w-md w-full">
          <h1 className="text-2xl font-semibold text-foreground mb-2">
            Account Verified
          </h1>
          <p className="text-muted-foreground">
            Your account has already been verified successfully.
          </p>
        </div>
      </div>
    );
  }

  /* -------------------------------
     NOT LOGGED IN UI
  --------------------------------*/
  if (!userId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-destructive text-lg font-medium">
          User not logged in
        </p>
      </div>
    );
  }

  /* -------------------------------
     MAIN UI
  --------------------------------*/
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="bg-card border shadow-sm w-full max-w-md rounded-xl p-8">
        <h1 className="text-2xl font-semibold text-center mb-6 text-foreground">
          Verify Your Account
        </h1>

        <div className="space-y-6">
          {/* Send OTP Section */}
          <div>
            <h2 className="text-sm font-medium text-foreground mb-2">
              Step 1: Send OTP
            </h2>
            <SendOtpForm
              email={email}
              loading={sendingOtp}
              setLoading={setSendingOtp}
              setMessage={setMessage}
              sendOtpUrl={`/api/user/${userId}/otp/send`}
            />
          </div>

          {/* Verify OTP Section */}
          <div>
            <h2 className="text-sm font-medium text-foreground mb-2">
              Step 2: Verify OTP
            </h2>
            <VerifyOtpForm
              email={email}
              code={code}
              setCode={setCode}
              loading={verifyingOtp}
              setLoading={setVerifyingOtp}
              setMessage={setMessage}
              verifyOtpUrl={`/api/user/${userId}/otp/verify`}
              onSuccess={() => {
                updateUser({ emailVerified: true });
                setMessage("OTP verified successfully.");
              }}
            />
          </div>

          {/* Message */}
          {message && (
            <div className="text-center text-sm text-primary">
              {message}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
