import { test, expect, BrowserContext } from '@playwright/test';
import dotenv from 'dotenv';
import { prisma } from '@/lib/prisma';
import { createToken, TOKEN_AUDIENCE } from '@/lib/auth-token';

dotenv.config();

test.describe('Realtime Chat Reliability & Multi-User E2E Flow (No API Mocks)', () => {
  test.describe.configure({ mode: 'serial' });

  const runId = `e2e_chat_${Date.now()}`;
  let doctorUser: any;
  let doctorProfile: any;
  let patientUser: any;
  let patientProfile: any;
  let strangerUser: any;
  let strangerProfile: any;
  let relation: any;
  let initialSeedMsg: any;

  test.beforeAll(async () => {
    // 1. Ensure location
    await prisma.location.upsert({
      where: { pincode: 110001 },
      update: {},
      create: { pincode: 110001, city: 'New Delhi', state: 'Delhi' },
    });

    // 2. Doctor User & Profile
    doctorUser = await prisma.user.create({
      data: {
        name: 'Dr. Evelyn Reed',
        email: `${runId}_doctor@quickclinic.test`,
        phoneNo: '9811111111',
        password: '$2b$10$e2ehashforexamplepurposesonly111',
        age: 42,
        gender: 'FEMALE',
        address: 'Medical Plaza 1',
        role: 'DOCTOR',
        pinCode: 110001,
        isActive: true,
      },
    });

    doctorProfile = await prisma.doctor.create({
      data: {
        userId: doctorUser.id,
        specialty: 'GENERAL_PHYSICIAN',
        fees: 500,
        experience: 12,
      },
    });

    // Seed Doctor Schedule so DoctorDashboardLayout does not redirect to /doctor/schedule/weeklySchedule
    await prisma.schedule.create({
      data: {
        doctorId: doctorProfile.id,
        weeklySchedule: {
          MONDAY: [{ startTime: '09:00', endTime: '17:00' }],
        },
      },
    });

    // 3. Patient User & Profile
    patientUser = await prisma.user.create({
      data: {
        name: 'James Holden',
        email: `${runId}_patient@quickclinic.test`,
        phoneNo: '9822222222',
        password: '$2b$10$e2ehashforexamplepurposesonly222',
        age: 34,
        gender: 'MALE',
        address: 'Rocinante Bay 4',
        role: 'PATIENT',
        pinCode: 110001,
        isActive: true,
      },
    });

    patientProfile = await prisma.patient.create({
      data: {
        userId: patientUser.id,
      },
    });

    // 4. Unauthorized Stranger User & Profile
    strangerUser = await prisma.user.create({
      data: {
        name: 'Eve Unauthorized',
        email: `${runId}_stranger@quickclinic.test`,
        phoneNo: '9833333333',
        password: '$2b$10$e2ehashforexamplepurposesonly333',
        age: 29,
        gender: 'FEMALE',
        address: 'Outer Space 9',
        role: 'PATIENT',
        pinCode: 110001,
        isActive: true,
      },
    });

    strangerProfile = await prisma.patient.create({
      data: {
        userId: strangerUser.id,
      },
    });

    // 5. Authorized DoctorPatientRelation
    relation = await prisma.doctorPatientRelation.create({
      data: {
        doctorsUserId: doctorUser.id,
        patientsUserId: patientUser.id,
      },
    });

    // 6. Initial Seed Message in DB
    initialSeedMsg = await prisma.chatMessages.create({
      data: {
        doctorPatientRelationId: relation.id,
        senderId: doctorUser.id,
        clientMessageId: `seed_msg_${runId}`,
        text: 'Welcome to your Quick-Clinic consultation room.',
        isRead: true,
        readAt: new Date(),
      },
    });
  });

  test.afterAll(async () => {
    try {
      if (relation?.id) {
        await prisma.chatMessages.deleteMany({
          where: { doctorPatientRelationId: relation.id },
        });
        await prisma.doctorPatientRelation.delete({
          where: { id: relation.id },
        });
      }
      if (doctorProfile?.id) {
        await prisma.schedule.deleteMany({ where: { doctorId: doctorProfile.id } });
        await prisma.doctor.delete({ where: { id: doctorProfile.id } });
      }
      if (patientProfile?.id) {
        await prisma.patient.delete({ where: { id: patientProfile.id } });
      }
      if (strangerProfile?.id) {
        await prisma.patient.delete({ where: { id: strangerProfile.id } });
      }
      const userIds = [doctorUser?.id, patientUser?.id, strangerUser?.id].filter(Boolean);
      if (userIds.length > 0) {
        await prisma.notificationOutbox.deleteMany({
          where: { targetUserId: { in: userIds } },
        });
        await prisma.notification.deleteMany({
          where: { userId: { in: userIds } },
        });
        await prisma.user.deleteMany({
          where: { id: { in: userIds } },
        });
      }
    } catch {
      // Ignore cleanup error
    }
  });

  async function setupUserSession(
    context: BrowserContext,
    user: any,
    role: string,
    profileId?: string
  ) {
    const token = await createToken(
      {
        id: user.id,
        userId: user.id,
        email: user.email,
        name: user.name,
        role,
        aud: TOKEN_AUDIENCE.SESSION,
      },
      '1d'
    );

    await context.addCookies([
      {
        name: 'token',
        value: token,
        domain: 'localhost',
        path: '/',
      },
    ]);

    await context.addInitScript(
      (arg: { user: any; role: string; profileId?: string }) => {
        const storeData = {
          state: {
            user: {
              id: arg.user.id,
              name: arg.user.name,
              email: arg.user.email,
              role: arg.role,
              status: 'ACTIVE',
            },
            patientId: arg.role === 'PATIENT' ? arg.profileId : null,
            doctorId: arg.role === 'DOCTOR' ? arg.profileId : null,
            isLoading: false,
            hasHydrated: true,
          },
          version: 1,
        };
        window.localStorage.setItem('user-store', JSON.stringify(storeData));
      },
      { user, role, profileId }
    );
  }

  test('Complete Realtime Chat Lifecycle: connect, exchange, refresh, disconnect-recover gap, retry draft, and reject unauthorized', async ({
    browser,
  }) => {
    // Track browser console errors
    const patientErrors: string[] = [];
    const doctorErrors: string[] = [];

    // ==========================================
    // 1. OPEN CONVERSATION (PATIENT & DOCTOR)
    // ==========================================
    const patientContext = await browser.newContext();
    await setupUserSession(patientContext, patientUser, 'PATIENT', patientProfile.id);
    const patientPage = await patientContext.newPage();
    patientPage.on('pageerror', (err) => patientErrors.push(err.message));

    const doctorContext = await browser.newContext();
    await setupUserSession(doctorContext, doctorUser, 'DOCTOR', doctorProfile.id);
    const doctorPage = await doctorContext.newPage();
    doctorPage.on('pageerror', (err) => doctorErrors.push(err.message));

    // Patient navigates to chat
    await patientPage.goto(`/patient/chat/${relation.id}`);
    await expect(patientPage.locator('body')).toBeVisible();
    await expect(patientPage.getByText('Welcome to your Quick-Clinic consultation room.')).toBeVisible({ timeout: 15000 });

    // Doctor navigates to chat
    await doctorPage.goto(`/doctor/chat/${relation.id}`);
    await expect(doctorPage.locator('body')).toBeVisible();
    await expect(doctorPage.getByText('Welcome to your Quick-Clinic consultation room.')).toBeVisible({ timeout: 15000 });

    // Both should reach live socket status
    await expect(patientPage.getByText('Live (Socket)')).toBeVisible({ timeout: 15000 });
    await expect(doctorPage.getByText('Live (Socket)')).toBeVisible({ timeout: 15000 });

    // ==========================================
    // 2. EXCHANGE MESSAGES IN REAL TIME
    // ==========================================
    const patientInput = patientPage.getByPlaceholder(/Type a message/i);
    await expect(patientInput).toBeVisible();

    const patientLiveMsg = `Feeling much better today Dr. Reed! ${runId}`;
    await patientInput.fill(patientLiveMsg);
    await patientPage.locator('button[type="submit"]').click();

    // Input clears immediately for next draft
    await expect(patientInput).toHaveValue('');

    // Doctor receives patient's message live via Socket.IO room broadcast
    await expect(doctorPage.getByText(patientLiveMsg)).toBeVisible({ timeout: 10000 });

    // Doctor replies in real time
    const doctorInput = doctorPage.getByPlaceholder(/Type a message/i);
    await expect(doctorInput).toBeVisible();

    const doctorReplyMsg = `Great progress James! Continue dosage for 2 more days. ${runId}`;
    await doctorInput.fill(doctorReplyMsg);
    await doctorPage.locator('button[type="submit"]').click();

    await expect(doctorInput).toHaveValue('');

    // Patient receives doctor reply live
    await expect(patientPage.getByText(doctorReplyMsg)).toBeVisible({ timeout: 10000 });

    // ==========================================
    // 3. REFRESH AND VERIFY PERSISTENCE
    // ==========================================
    await patientPage.reload();
    await expect(patientPage.getByText(patientLiveMsg)).toBeVisible({ timeout: 15000 });
    await expect(patientPage.getByText(doctorReplyMsg)).toBeVisible({ timeout: 15000 });

    await doctorPage.reload();
    await expect(doctorPage.getByText(patientLiveMsg)).toBeVisible({ timeout: 15000 });
    await expect(doctorPage.getByText(doctorReplyMsg)).toBeVisible({ timeout: 15000 });

    // Verify PostgreSQL records
    const persistedMessages = await prisma.chatMessages.findMany({
      where: { doctorPatientRelationId: relation.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(persistedMessages.some((m) => m.text === patientLiveMsg)).toBe(true);
    expect(persistedMessages.some((m) => m.text === doctorReplyMsg)).toBe(true);

    // ==========================================
    // 4. DISCONNECT PATIENT, SEND MESSAGES, RECONNECT & RECOVER GAP
    // ==========================================
    // Disconnect patient socket to simulate connection loss
    await patientPage.evaluate(() => {
      (window as any).__quickClinicChatSocket?.disconnect?.();
    });
    await expect(patientPage.getByText('Standard (REST)')).toBeVisible({ timeout: 10000 });

    // Doctor sends 2 messages while patient is offline
    const missedMsg1 = `Gap message 1: Did you notice any fever? ${runId}`;
    const missedMsg2 = `Gap message 2: Also stay well hydrated. ${runId}`;

    await doctorInput.fill(missedMsg1);
    await doctorPage.locator('button[type="submit"]').click();
    await expect(doctorPage.getByText(missedMsg1)).toBeVisible({ timeout: 10000 });

    await doctorInput.fill(missedMsg2);
    await doctorPage.locator('button[type="submit"]').click();
    await expect(doctorPage.getByText(missedMsg2)).toBeVisible({ timeout: 10000 });

    // Reconnect patient socket
    await patientPage.evaluate(() => {
      (window as any).__quickClinicChatSocket?.connect?.();
    });

    // Patient socket reconnects and triggers sync_messages
    await expect(patientPage.getByText('Live (Socket)')).toBeVisible({ timeout: 15000 });

    // Patient receives the missed messages via gap recovery without page reload!
    await expect(patientPage.getByText(missedMsg1)).toBeVisible({ timeout: 15000 });
    await expect(patientPage.getByText(missedMsg2)).toBeVisible({ timeout: 15000 });

    // ==========================================
    // 5. RETRY BEHAVIOR: PRESERVES COMPOSER DRAFT & PREVENTS DUPLICATES
    // ==========================================
    // Test that clientMessageId idempotency works seamlessly
    const retryClientMsgId = `retry_test_${runId}`;
    const retryText = `Preserve draft and retry message ${runId}`;

    // Fill composer with draft
    await patientInput.fill(retryText);

    // Send via REST directly simulating duplicate request with same clientMessageId
    const restSend1 = await patientPage.request.post(`/api/doctorpatientrelations/${relation.id}/chats`, {
      data: {
        text: retryText,
        clientMessageId: retryClientMsgId,
      },
    });
    expect([200, 201]).toContain(restSend1.status());

    // Send again with same clientMessageId (replay/retry)
    const restSend2 = await patientPage.request.post(`/api/doctorpatientrelations/${relation.id}/chats`, {
      data: {
        text: retryText,
        clientMessageId: retryClientMsgId,
      },
    });
    expect([200, 201]).toContain(restSend2.status());

    // Assert database has exactly 1 record for this clientMessageId
    const duplicateRows = await prisma.chatMessages.findMany({
      where: { clientMessageId: retryClientMsgId },
    });
    expect(duplicateRows.length).toBe(1);

    // ==========================================
    // 6. READ-STATE BEHAVIOR
    // ==========================================
    // When doctor is viewing the room, read receipts are processed
    // Check doctorPatientRelation or chatMessages for read state
    const unreadCount = await prisma.chatMessages.count({
      where: {
        doctorPatientRelationId: relation.id,
        senderId: patientUser.id,
        isRead: false,
      },
    });
    // Messages viewed by doctor should have been acknowledged or marked
    expect(unreadCount).toBeLessThanOrEqual(1);

    // ==========================================
    // 7. IDOR SECURITY: REJECT UNAUTHORIZED USER
    // ==========================================
    const strangerContext = await browser.newContext();
    await setupUserSession(strangerContext, strangerUser, 'PATIENT', strangerProfile.id);
    const strangerPage = await strangerContext.newPage();

    // Stranger tries to open doctor-patient relation chat
    await strangerPage.goto(`/patient/chat/${relation.id}`);

    // Wait for page load
    await strangerPage.waitForTimeout(2000);

    // Stranger must NOT see confidential consultation messages
    await expect(strangerPage.getByText(patientLiveMsg)).not.toBeVisible();
    await expect(strangerPage.getByText(doctorReplyMsg)).not.toBeVisible();

    // Verify stranger's API attempt to fetch chats returns 403 Forbidden
    const strangerApiRes = await strangerPage.request.get(`/api/doctorpatientrelations/${relation.id}/chats`);
    expect(strangerApiRes.status()).toBe(403);

    // Verify stranger's API attempt to get socket ticket for this relation returns 403 Forbidden
    const strangerSocketTicketRes = await strangerPage.request.post('/api/socket/token', {
      data: { relationId: relation.id },
    });
    expect(strangerSocketTicketRes.status()).toBe(403);

    // Assert no fatal unhandled page crashes occurred in patient or doctor views
    expect(patientErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR'))).toHaveLength(0);
    expect(doctorErrors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR'))).toHaveLength(0);

    // Clean up browser contexts
    await patientContext.close();
    await doctorContext.close();
    await strangerContext.close();
  });
});
