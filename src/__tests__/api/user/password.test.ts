import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as changePasswordPOST } from "@/app/api/user/change-password/route";
import { POST as resetPasswordPOST } from "@/app/api/user/reset-password/route";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

test("POST /api/user/change-password - changes password successfully for any role", async () => {
  const testEmail = `test_pwd_change_${Date.now()}@example.com`;
  const initialHashed = await bcrypt.hash("initial_pass_123", 10);

  const testUser = await prisma.user.create({
    data: {
      email: testEmail,
      name: "Password Change Tester",
      phoneNo: "9988776655",
      password: initialHashed,
      age: 30,
      gender: "MALE",
      role: "PATIENT",
      address: "123 Street",
      pinCode: 121004,
    },
  });

  const req = new NextRequest("http://localhost:3000/api/user/change-password", {
    method: "POST",
    body: JSON.stringify({
      email: testEmail,
      currentPassword: "initial_pass_123",
      newPassword: "new_pass_456789",
    }),
  });

  const res = await changePasswordPOST(req);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.message).toBe("Password changed successfully");

  // Verify new password works
  const updatedUser = await prisma.user.findUnique({ where: { id: testUser.id } });
  const isMatch = await bcrypt.compare("new_pass_456789", updatedUser!.password);
  expect(isMatch).toBe(true);

  // Cleanup
  await prisma.user.delete({ where: { id: testUser.id } });
});

test("POST /api/user/change-password - returns 400 for incorrect current password", async () => {
  const testEmail = `test_pwd_err_${Date.now()}@example.com`;
  const initialHashed = await bcrypt.hash("initial_pass_123", 10);

  const testUser = await prisma.user.create({
    data: {
      email: testEmail,
      name: "Password Error Tester",
      phoneNo: "9988776655",
      password: initialHashed,
      age: 30,
      gender: "MALE",
      role: "DOCTOR",
      address: "123 Clinic",
      pinCode: 121004,
    },
  });

  const req = new NextRequest("http://localhost:3000/api/user/change-password", {
    method: "POST",
    body: JSON.stringify({
      email: testEmail,
      currentPassword: "wrongpassword",
      newPassword: "new_pass_456789",
    }),
  });

  const res = await changePasswordPOST(req);
  expect(res.status).toBe(400);

  const data = await res.json();
  expect(data.error).toBe("Current password is incorrect");

  // Cleanup
  await prisma.user.delete({ where: { id: testUser.id } });
});

test("POST /api/user/reset-password - resets password successfully for any role", async () => {
  const testEmail = `test_pwd_reset_${Date.now()}@example.com`;
  const initialHashed = await bcrypt.hash("old_pass_123", 10);

  const testUser = await prisma.user.create({
    data: {
      email: testEmail,
      name: "Password Reset Tester",
      phoneNo: "9988776655",
      password: initialHashed,
      age: 35,
      gender: "BINARY",
      role: "ADMIN",
      address: "123 Admin Office",
      pinCode: 110001,
    },
  });

  const req = new NextRequest("http://localhost:3000/api/user/reset-password", {
    method: "POST",
    body: JSON.stringify({
      email: testEmail,
      newPassword: "brand_new_pass_999",
    }),
  });

  const res = await resetPasswordPOST(req);
  expect(res.status).toBe(200);

  const data = await res.json();
  expect(data.message).toBe("Password reset successfully");

  // Verify updated in DB
  const updatedUser = await prisma.user.findUnique({ where: { id: testUser.id } });
  const isMatch = await bcrypt.compare("brand_new_pass_999", updatedUser!.password);
  expect(isMatch).toBe(true);

  // Cleanup
  await prisma.user.delete({ where: { id: testUser.id } });
});
