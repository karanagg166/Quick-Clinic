import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { GET as notificationsGET } from '@/app/api/user/[userId]/notification/route';
import {
  PATCH as notificationPATCH,
  DELETE as notificationDELETE,
} from '@/app/api/user/[userId]/notification/[id]/route';
import { prisma } from '@/lib/prisma';
import { buildUserPayload } from '@/__tests__/helpers/factories';

describe('Phase 35: User Notifications Lifecycle & Access Isolation Test Suite', () => {
  let user1Id: string;
  let user2Id: string;
  let notif1Id: string;
  let notif2Id: string;
  let notifUser2Id: string;

  beforeAll(async () => {
    // 1. Create User 1
    const u1Payload = buildUserPayload({
      name: 'Notification User One',
      email: `notif_u1_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const u1 = await prisma.user.create({
      data: {
        name: u1Payload.name,
        email: u1Payload.email,
        phoneNo: u1Payload.phoneNo,
        password: u1Payload.password,
        age: 28,
        address: u1Payload.address,
        role: 'PATIENT',
        gender: 'MALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    user1Id = u1.id;

    // 2. Create User 2
    const u2Payload = buildUserPayload({
      name: 'Notification User Two',
      email: `notif_u2_${Date.now()}@quickclinic.test`,
      role: 'PATIENT',
    });
    const u2 = await prisma.user.create({
      data: {
        name: u2Payload.name,
        email: u2Payload.email,
        phoneNo: u2Payload.phoneNo,
        password: u2Payload.password,
        age: 35,
        address: u2Payload.address,
        role: 'PATIENT',
        gender: 'FEMALE',
        location: {
          connectOrCreate: {
            where: { pincode: 121004 },
            create: { pincode: 121004, city: 'Faridabad', state: 'Haryana' },
          },
        },
      },
    });
    user2Id = u2.id;

    // 3. Create sample notifications for User 1
    const n1 = await prisma.notification.create({
      data: {
        userId: user1Id,
        message: 'Your appointment with Dr. Sharma has been confirmed.',
        actionHref: '/appointments/appt_101',
        actionLabel: 'View Details',
        isRead: false,
        status: 'UNREAD',
      },
    });
    notif1Id = n1.id;

    const n2 = await prisma.notification.create({
      data: {
        userId: user1Id,
        message: 'You have a new message from Dr. Sharma.',
        actionHref: '/chat/rel_101',
        actionLabel: 'Open Chat',
        isRead: false,
        status: 'UNREAD',
      },
    });
    notif2Id = n2.id;

    // 4. Create sample notification for User 2
    const n3 = await prisma.notification.create({
      data: {
        userId: user2Id,
        message: 'Welcome to Quick-Clinic!',
        isRead: false,
        status: 'UNREAD',
      },
    });
    notifUser2Id = n3.id;
  });

  afterAll(async () => {
    try {
      await prisma.notification.deleteMany({
        where: { userId: { in: [user1Id, user2Id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [user1Id, user2Id] } },
      });
    } catch (e) {
      console.warn('Phase 35 cleanup warning:', e);
    }
  });

  it('35.1 GET returns all notifications for User 1 ordered by newest first', async () => {
    const req = new NextRequest(`http://localhost:3000/api/user/${user1Id}/notification`);
    const res = await notificationsGET(req, { params: Promise.resolve({ userId: user1Id }) });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBe(2);
    expect(data[0].id).toBe(notif2Id); // newest first
    expect(data[0].message).toBe('You have a new message from Dr. Sharma.');
    expect(data[0].isRead).toBe(false);
    expect(data[0].status).toBe('UNREAD');
  });

  it('35.2 GET returns empty list for user with no notifications', async () => {
    const req = new NextRequest('http://localhost:3000/api/user/non_existent_user_id/notification');
    const res = await notificationsGET(req, { params: Promise.resolve({ userId: 'non_existent_user_id' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual([]);
  });

  it('35.3 PATCH updates notification status to READ and isRead=true', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/user/${user1Id}/notification/${notif1Id}`,
      { method: 'PATCH' }
    );
    const res = await notificationPATCH(req, {
      params: Promise.resolve({ userId: user1Id, id: notif1Id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.id).toBe(notif1Id);
    expect(data.isRead).toBe(true);
    expect(data.status).toBe('READ');
    expect(data.readAt).toBeDefined();

    // Verify DB update
    const inDb = await prisma.notification.findUnique({ where: { id: notif1Id } });
    expect(inDb?.isRead).toBe(true);
    expect(inDb?.status).toBe('READ');
  });

  it('35.4 Isolation: User 1 cannot mark User 2 notification as read (403 Forbidden)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/user/${user1Id}/notification/${notifUser2Id}`,
      { method: 'PATCH' }
    );
    const res = await notificationPATCH(req, {
      params: Promise.resolve({ userId: user1Id, id: notifUser2Id }),
    });
    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toMatch(/Unauthorized or not found/i);

    // Verify User 2 notification remains unread
    const inDb = await prisma.notification.findUnique({ where: { id: notifUser2Id } });
    expect(inDb?.isRead).toBe(false);
  });

  it('35.5 Isolation: User 1 cannot delete User 2 notification (403 Forbidden)', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/user/${user1Id}/notification/${notifUser2Id}`,
      { method: 'DELETE' }
    );
    const res = await notificationDELETE(req, {
      params: Promise.resolve({ userId: user1Id, id: notifUser2Id }),
    });
    expect(res.status).toBe(403);

    // Verify User 2 notification is still in DB
    const inDb = await prisma.notification.findUnique({ where: { id: notifUser2Id } });
    expect(inDb).not.toBeNull();
  });

  it('35.6 DELETE removes notification from database when authorized', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/user/${user1Id}/notification/${notif2Id}`,
      { method: 'DELETE' }
    );
    const res = await notificationDELETE(req, {
      params: Promise.resolve({ userId: user1Id, id: notif2Id }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.message).toBe('Notification deleted');

    // Verify DB deletion
    const inDb = await prisma.notification.findUnique({ where: { id: notif2Id } });
    expect(inDb).toBeNull();
  });

  it('35.7 PATCH returns 403 when updating non-existent notification ID', async () => {
    const req = new NextRequest(
      `http://localhost:3000/api/user/${user1Id}/notification/non_existent_notif`,
      { method: 'PATCH' }
    );
    const res = await notificationPATCH(req, {
      params: Promise.resolve({ userId: user1Id, id: 'non_existent_notif' }),
    });
    expect(res.status).toBe(403);
  });
});
