"use client";

import React from "react";

interface Props {
  email: string;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setMessage: (v: string) => void;
  sendOtpUrl: string;
}

export function SendOtpForm({
  email,
  loading,
  setLoading,
  setMessage,
  sendOtpUrl,
}: Props) {
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setMessage("");

    try {
      const response = await fetch(sendOtpUrl, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to send OTP");
      }

      if (data?.otp) {
        setMessage(`OTP (dev mode): ${data.otp}`);
      } else {
        setMessage("OTP sent successfully.");
      }
    } catch (error: any) {
      setMessage(error.message || "Error sending OTP.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSendOtp} className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Email address
        </label>
        <div className="w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {email || ""}
        </div>
      </div>

      <button
        type="submit"
        disabled={loading || !email}
        className="w-full rounded-md bg-blue-600 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sending OTP..." : "Send OTP"}
      </button>
    </form>
  );
}

export default SendOtpForm;
