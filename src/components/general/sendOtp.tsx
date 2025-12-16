"use client";

import React from "react";

interface Props {
  email: string;
  setEmail: (v: string) => void;
  loading: boolean;
  setLoading: (v: boolean) => void;
  setMessage: (v: string) => void;
  sendOtpUrl: string;
}

export function SendOtpForm({
  email,
  setEmail,
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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to send OTP");
      }

      setMessage("OTP sent successfully.");
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
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-md bg-blue-600 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Sending OTP..." : "Send OTP"}
      </button>
    </form>
  );
}

export default SendOtpForm;
