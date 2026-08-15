import { test, expect } from "vitest";
import { NextRequest } from "next/server";
import { GET as notificationsGET } from "@/app/api/user/[userId]/notification/route";
import { PATCH as notificationPATCH, DELETE as notificationDELETE } from "@/app/api/user/[userId]/notification/[id]/route";
import { prisma } from "@/lib/prisma";

test("GET /api/user/[userId]/notification - fetches notifications for user", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });

  // Create test notification
  const notification = await prisma.notification.create({
    data: {
      userId: user!.id,
      message: "Test notification message",
    },
  });

  const req = new NextRequest(`http://localhost:3000/api/user/${user!.id}/notification`);
  const res = await notificationsGET(req, {
    params: Promise.resolve({ userId: user!.id }),
  });
  expect(res.status).toBe(200);

  const list = await res.json();
  expect(Array.isArray(list)).toBe(true);
  expect(list.some((n: any) => n.id === notification.id)).toBe(true);

  // Clean up
  await prisma.notification.delete({ where: { id: notification.id } });
});

test("PATCH /api/user/[userId]/notification/[id] - marks notification as read", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });

  const notification = await prisma.notification.create({
    data: {
      userId: user!.id,
      message: "Test unread notification",
      isRead: false,
    },
  });

  const req = new Request(`http://localhost:3000/api/user/${user!.id}/notification/${notification.id}`, {
    method: "PATCH",
  });

  const res = await notificationPATCH(req, {
    params: Promise.resolve({ userId: user!.id, id: notification.id }),
  });
  expect(res.status).toBe(200);

  const updated = await res.json();
  expect(updated.isRead).toBe(true);
  expect(updated.status).toBe("READ");

  // Clean up
  await prisma.notification.delete({ where: { id: notification.id } });
});

test("DELETE /api/user/[userId]/notification/[id] - deletes notification", async () => {
  const user = await prisma.user.findFirst({
    where: { email: "karan@gmail.com" },
  });

  const notification = await prisma.notification.create({
    data: {
      userId: user!.id,
      message: "Notification to delete",
    },
  });

  const req = new Request(`http://localhost:3000/api/user/${user!.id}/notification/${notification.id}`, {
    method: "DELETE",
  });

  const res = await notificationDELETE(req, {
    params: Promise.resolve({ userId: user!.id, id: notification.id }),
  });
  expect(res.status).toBe(200);

  const deleted = await prisma.notification.findUnique({
    where: { id: notification.id },
  });
  expect(deleted).toBeNull();
});
