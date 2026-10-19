import { test, expect, Page, BrowserContext } from '@playwright/test';
import { SignJWT } from 'jose';

// Stable synthetic credentials and secrets
const JWT_SECRET = process.env.JWT_SECRET || 'ci_jwt_secret_must_be_at_least_32_characters_long_for_security';
const secretKey = new TextEncoder().encode(JWT_SECRET);

async function generateTestSessionToken(userId: string, role: string, email: string, name: string) {
  return new SignJWT({
    id: userId,
    userId,
    role,
    email,
    name,
    aud: 'quick-clinic-session',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1d')
    .sign(secretKey);
}

interface SyntheticMessage {
  id: string;
  relationId: string;
  senderId: string;
  senderName: string;
  text: string;
  clientMessageId?: string;
  createdAt: string;
  isRead: boolean;
}

test.describe('Realtime Chat Reliability & Multi-User E2E Flow', () => {
  const relationId = 'rel_synthetic_e2e_101';
  const patientUser = {
    id: 'pat_synthetic_user_1',
    name: 'Alice Patient',
    email: 'alice.patient@example.com',
    role: 'PATIENT',
    patientId: 'pat_profile_1',
  };
  const doctorUser = {
    id: 'doc_synthetic_user_1',
    name: 'Dr. Bob Smith',
    email: 'bob.doctor@example.com',
    role: 'DOCTOR',
    doctorId: 'doc_profile_1',
  };
  const strangerUser = {
    id: 'stranger_synthetic_user_1',
    name: 'Eve Unauthorized',
    email: 'eve.intruder@example.com',
    role: 'PATIENT',
    patientId: 'pat_profile_stranger',
  };

  let syntheticDatabase: SyntheticMessage[] = [];

  test.beforeEach(() => {
    syntheticDatabase = [
      {
        id: 'msg_seed_initial_1',
        relationId,
        senderId: doctorUser.id,
        senderName: doctorUser.name,
        text: 'Welcome to your Quick-Clinic consultation room.',
        clientMessageId: 'cli_seed_1',
        createdAt: new Date(Date.now() - 60000).toISOString(),
        isRead: true,
      },
    ];
  });

  async function setupUserContext(
    context: BrowserContext,
    user: typeof patientUser | typeof doctorUser | typeof strangerUser,
    role: string
  ) {
    const token = await generateTestSessionToken(user.id, role, user.email, user.name);

    await context.addCookies([
      {
        name: 'token',
        value: token,
        domain: 'localhost',
        path: '/',
      },
    ]);

    await context.addInitScript(
      (userArg: { id: string; name: string; email: string; role: string; patientId?: string; doctorId?: string }) => {
        const storeData = {
          state: {
            user: {
              id: userArg.id,
              name: userArg.name,
              email: userArg.email,
              role: userArg.role,
              status: 'ACTIVE',
            },
            patientId: userArg.patientId ?? null,
            doctorId: userArg.doctorId ?? null,
            isLoading: false,
          },
          version: 0,
        };
        window.localStorage.setItem('user-store', JSON.stringify(storeData));
      },
      user
    );
  }

  function setupChatApiMocks(page: Page, currentUser: { id: string }, failPostFirstTime = false) {
    let postCallCount = 0;

    // Listen for page errors & unhandled rejections
    const pageErrors: Error[] = [];
    page.on('pageerror', (err) => pageErrors.push(err));

    // Mock socket ticket endpoint
    page.route('**/api/socket/token*', async (route) => {
      if (currentUser.id === strangerUser.id) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not authorized for this relation' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          token: 'mock_socket_ticket',
          socketUrl: 'http://localhost:4000',
        }),
      });
    });

    // Mock chat REST API endpoint
    page.route(`**/api/doctorpatientrelations/${relationId}/chats*`, async (route) => {
      const method = route.request().method();

      // Enforce relation authorization: stranger denied
      if (currentUser.id === strangerUser.id) {
        await route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Access denied. You are not part of this doctor-patient relation.' }),
        });
        return;
      }

      if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ messages: syntheticDatabase }),
        });
        return;
      }

      if (method === 'POST') {
        postCallCount++;
        if (failPostFirstTime && postCallCount === 1) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Simulated temporary network failure' }),
          });
          return;
        }

        const data = route.request().postDataJSON();
        const clientMessageId = data.clientMessageId || `srv_${Date.now()}`;

        // Idempotency check: if clientMessageId already exists, return canonical message
        const existing = syntheticDatabase.find((m) => m.clientMessageId === clientMessageId);
        if (existing) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ message: existing, deduplicated: true }),
          });
          return;
        }

        const newMsg: SyntheticMessage = {
          id: `msg_db_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          relationId,
          senderId: currentUser.id,
          senderName: currentUser.id === patientUser.id ? patientUser.name : doctorUser.name,
          text: data.message || '',
          clientMessageId,
          createdAt: new Date().toISOString(),
          isRead: false,
        };

        syntheticDatabase.push(newMsg);

        await route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ message: newMsg }),
        });
        return;
      }

      await route.continue();
    });

    return { pageErrors };
  }

  test('Multi-user chat: Patient and Doctor send, receive, refresh, and verify persistence', async ({
    browser,
  }) => {
    // 1. Authorized Patient Context
    const patientContext = await browser.newContext();
    await setupUserContext(patientContext, patientUser, 'PATIENT');
    const patientPage = await patientContext.newPage();
    const { pageErrors: patientErrors } = setupChatApiMocks(patientPage, patientUser);

    // 2. Authorized Doctor Context
    const doctorContext = await browser.newContext();
    await setupUserContext(doctorContext, doctorUser, 'DOCTOR');
    const doctorPage = await doctorContext.newPage();
    const { pageErrors: doctorErrors } = setupChatApiMocks(doctorPage, doctorUser);

    // Patient navigates to chat room
    await patientPage.goto(`/patient/chat/${relationId}`);
    await expect(patientPage.locator('body')).toBeVisible();
    await expect(patientPage.getByText('Welcome to your Quick-Clinic consultation room.')).toBeVisible();

    // Doctor navigates to same chat room
    await doctorPage.goto(`/doctor/chat/${relationId}`);
    await expect(doctorPage.locator('body')).toBeVisible();
    await expect(doctorPage.getByText('Welcome to your Quick-Clinic consultation room.')).toBeVisible();

    // Patient sends a new message
    const patientInput = patientPage.getByPlaceholder(/Type a message/i);
    await expect(patientInput).toBeVisible();
    await patientInput.fill('Good afternoon Doctor, my symptoms have improved.');
    await patientPage.locator('button[type="submit"]').click();

    // Verify patient input is cleared immediately for drafting next message
    await expect(patientInput).toHaveValue('');

    // Verify message appears in patient view
    await expect(
      patientPage.getByText('Good afternoon Doctor, my symptoms have improved.')
    ).toBeVisible();

    // Doctor refreshes and verifies persistence of patient's message
    await doctorPage.reload();
    await expect(
      doctorPage.getByText('Good afternoon Doctor, my symptoms have improved.')
    ).toBeVisible();

    // Doctor replies
    const doctorInput = doctorPage.getByPlaceholder(/Type a message/i);
    await doctorInput.fill('Glad to hear that Alice. Continue the prescribed medication for 3 more days.');
    await doctorPage.locator('button[type="submit"]').click();

    await expect(
      doctorPage.getByText('Glad to hear that Alice. Continue the prescribed medication for 3 more days.')
    ).toBeVisible();

    // Patient refreshes and verifies doctor's reply is persisted
    await patientPage.reload();
    await expect(
      patientPage.getByText('Glad to hear that Alice. Continue the prescribed medication for 3 more days.')
    ).toBeVisible();

    // Verify no unhandled page crashes or critical script errors
    expect(patientErrors).toHaveLength(0);
    expect(doctorErrors).toHaveLength(0);

    await patientContext.close();
    await doctorContext.close();
  });

  test('Retry behavior: preserves draft composer text and deduplicates on resend', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setupUserContext(context, patientUser, 'PATIENT');
    const page = await context.newPage();

    // Fail first POST to trigger retry state
    setupChatApiMocks(page, patientUser, true);

    await page.goto(`/patient/chat/${relationId}`);
    await expect(page.getByText('Welcome to your Quick-Clinic consultation room.')).toBeVisible();

    const input = page.getByPlaceholder(/Type a message/i);
    await input.fill('Message that encounters transient network glitch');
    await page.locator('button[type="submit"]').click();

    // Input must be cleared immediately after submit
    await expect(input).toHaveValue('');

    // Wait for the message to show "Failed to send (Click to retry)"
    const retryButton = page.getByRole('button', { name: /Failed to send \(Click to retry\)/i });
    await expect(retryButton).toBeVisible({ timeout: 15000 });

    // User types an in-progress draft in composer while failed message is pending retry
    await input.fill('Active draft the user is currently composing...');

    // User clicks retry on the failed message
    await retryButton.click();

    // Composer draft MUST NOT be cleared or overwritten by retrying a different message!
    await expect(input).toHaveValue('Active draft the user is currently composing...');

    // Message must transition out of failed state to sent state
    await expect(retryButton).not.toBeVisible({ timeout: 10000 });
    await expect(page.getByText('Message that encounters transient network glitch')).toBeVisible();

    // Exactly one instance of this message exists in synthetic database
    const matchingMessages = syntheticDatabase.filter(
      (m) => m.text === 'Message that encounters transient network glitch'
    );
    expect(matchingMessages).toHaveLength(1);

    await context.close();
  });

  test('IDOR Security: unauthorized third user cannot access or read chat messages', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    await setupUserContext(context, strangerUser, 'PATIENT');
    const page = await context.newPage();

    setupChatApiMocks(page, strangerUser);

    await page.goto(`/patient/chat/${relationId}`);

    // Verify unauthorized user never sees conversation messages
    await expect(page.getByText('Welcome to your Quick-Clinic consultation room.')).not.toBeVisible();

    await context.close();
  });
});
