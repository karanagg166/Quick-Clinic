import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUserStore } from "@/store";
import { SendOtpForm } from "@/components/general/sendOtp";
import { VerifyOtpForm } from "@/components/general/verifyOtp";
import { showToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { CheckCircle2, ArrowRight } from "lucide-react";

export default function VerifyPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);

  const user = useUserStore((state) => state.user);
  const updateUser = useUserStore((state) => state.updateUser);

  const email = user?.email || "";
  const userId = user?.id;
  const verified = user?.emailVerified;

  const dashboardHref =
    user?.role === "DOCTOR"
      ? "/doctor"
      : user?.role === "ADMIN"
      ? "/admin"
      : "/patient";

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
        <div className="bg-card rounded-xl border shadow-sm p-8 text-center max-w-md w-full space-y-4">
          <div className="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/50 rounded-full flex items-center justify-center mx-auto text-emerald-600">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-semibold text-foreground">
            Account Verified
          </h1>
          <p className="text-muted-foreground text-sm">
            Your account has already been verified successfully. You have full access to all features.
          </p>
          <div className="pt-2">
            <Button asChild className="w-full gap-2">
              <Link href={dashboardHref}>
                Go to Dashboard <ArrowRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
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
                setMessage("OTP verified successfully. Redirecting to dashboard...");
                showToast.success("Account verified successfully! Redirecting to dashboard...");
                setTimeout(() => {
                  router.push(dashboardHref);
                }, 1200);
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
