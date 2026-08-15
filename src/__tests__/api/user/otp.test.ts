import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as sendOtpPOST } from "@/app/api/user/[userId]/otp/send/route";
import { POST as verifyOtpPOST } from "@/app/api/user/[userId]/otp/verify/route";
import { prisma } from "@/lib/prisma";

test("POST /api/user/[userId]/otp/send - sends/generates OTP in development mode", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });
  expect(user).toBeDefined();

  const req = new NextRequest(`http://localhost:3000/api/user/${user!.id}/otp/send`, {
    method: "POST",
  });

  const res = await sendOtpPOST(req, {
    params: Promise.resolve({ userId: user!.id }),
  });
  expect(res.status).toBe(200);

  const otpRecord = await prisma.otp.findFirst({
    where: { userId: user!.id },
  });
  expect(otpRecord).toBeDefined();
  expect(otpRecord?.code).toBeTruthy();
});

test("POST /api/user/[userId]/otp/verify - rejects missing OTP", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });

  const req = new NextRequest(`http://localhost:3000/api/user/${user!.id}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({}),
  });

  const res = await verifyOtpPOST(req, {
    params: Promise.resolve({ userId: user!.id }),
  });
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.message).toBe("OTP is required");
});

test("POST /api/user/[userId]/otp/verify - rejects incorrect OTP", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });

  const req = new NextRequest(`http://localhost:3000/api/user/${user!.id}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ otp: "000000" }),
  });

  const res = await verifyOtpPOST(req, {
    params: Promise.resolve({ userId: user!.id }),
  });
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.message).toBe("Invalid OTP");
});

test("POST /api/user/[userId]/otp/verify - verifies valid OTP and marks emailVerified", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });

  // Ensure an OTP exists
  const code = "789123";
  await prisma.otp.upsert({
    where: { email: user!.email },
    update: {
      code,
      userId: user!.id,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
    create: {
      email: user!.email,
      userId: user!.id,
      code,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });

  const req = new NextRequest(`http://localhost:3000/api/user/${user!.id}/otp/verify`, {
    method: "POST",
    body: JSON.stringify({ otp: code }),
  });

  const res = await verifyOtpPOST(req, {
    params: Promise.resolve({ userId: user!.id }),
  });
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.message).toBe("OTP verified successfully");

  // Verify OTP record deleted
  const deletedOtp = await prisma.otp.findFirst({
    where: { userId: user!.id },
  });
  expect(deletedOtp).toBeNull();
});
