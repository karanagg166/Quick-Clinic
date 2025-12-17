

import React from "react";

interface Props {
  email: string;
  code: string;
  setCode: (v: string) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setMessage: (v: string) => void;
  verifyOtpUrl: string;
  onSuccess: (email: string) => void;
}

export function VerifyOtpForm({
  email,
  code,
  setCode,
  loading,
  setLoading,
  setMessage,
  verifyOtpUrl,
  onSuccess,
}: Props) {
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(verifyOtpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, otp:code }),
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Invalid OTP");
      }

      onSuccess(email);
    } catch (error: any) {
      setMessage(error.message || "Error verifying OTP.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleVerifyOtp} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          OTP Code
        </label>
        <input
          type="text"
          placeholder="Enter 6-digit OTP"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm tracking-widest text-center focus:outline-none focus:ring-2 focus:ring-green-500"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-green-600 py-2 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Verifying OTP..." : "Verify OTP"}
      </button>
    </form>
  );
}

export default VerifyOtpForm;
