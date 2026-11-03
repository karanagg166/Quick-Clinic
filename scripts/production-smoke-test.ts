/**
 * Quick-Clinic Production Post-Deployment Smoke Test Suite.
 *
 * Safe & Non-Destructive Deployment Verification across:
 * 1. Next.js Web Frontend & API on Vercel (https://quick-clinic-nine.vercel.app)
 * 2. Socket.IO Real-time Server on Render (https://quickclinic-socket-server.onrender.com)
 * 3. PostgreSQL Database Connectivity (verified via live /api/health/ready probes)
 *
 * Strict Production Safety:
 * - Read-only queries for doctors, slots, health, and auth boundaries.
 * - Never makes real payments, never creates real bookings, never alters patient records.
 */

import { io, Socket } from 'socket.io-client';
import * as fs from 'fs';
import {
  DEFAULT_CLINIC_TIMEZONE,
  localDateAndTimeToUtc,
  formatAppointmentTime,
  utcToLocalDateAndTime,
} from '../src/lib/dateUtils';

interface SmokeTestConfig {
  webUrl: string;
  socketUrl: string;
  timeoutMs: number;
}

const config: SmokeTestConfig = {
  webUrl: (process.env.PROD_WEB_URL || 'https://quick-clinic-nine.vercel.app').replace(/\/$/, ''),
  socketUrl: (process.env.PROD_SOCKET_URL || 'https://quickclinic-socket-server.onrender.com').replace(/\/$/, ''),
  timeoutMs: Number(process.env.SMOKE_TIMEOUT_MS) || 25000,
};

const results: { name: string; status: 'PASS' | 'FAIL' | 'BLOCKED'; detail: string }[] = [];

function recordPass(name: string, detail: string) {
  console.log(`\x1b[32m✓\x1b[0m ${name}: ${detail}`);
  results.push({ name, status: 'PASS', detail });
}

function recordFail(name: string, detail: string) {
  console.error(`\x1b[31m✗\x1b[0m ${name}: ${detail}`);
  results.push({ name, status: 'FAIL', detail });
}

async function httpGet(url: string, headers: Record<string, string> = {}): Promise<{ status: number; data: any; elapsedMs: number }> {
  const start = Date.now();
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'QuickClinicProductionSmoke/1.0',
      Accept: 'application/json, text/html',
      ...headers,
    },
  });
  const elapsedMs = Date.now() - start;
  const contentType = resp.headers.get('content-type') || '';
  let data: any = null;
  if (contentType.includes('application/json')) {
    data = await resp.json().catch(() => null);
  } else {
    data = await resp.text().catch(() => null);
  }
  return { status: resp.status, data, elapsedMs };
}

async function verifyFrontendAccessibility(): Promise<void> {
  const { status, data, elapsedMs } = await httpGet(config.webUrl);
  if (status !== 200) {
    throw new Error(`Frontend returned HTTP ${status}`);
  }
  if (typeof data !== 'string' || !data.includes('html')) {
    throw new Error(`Frontend response does not contain valid HTML document`);
  }
  recordPass('Frontend Accessibility', `Vercel responds HTTP 200 in ${elapsedMs}ms`);
}

async function verifyWebBackendReadiness(): Promise<void> {
  let lastError = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { status, data, elapsedMs } = await httpGet(`${config.webUrl}/api/health/ready`);
      if (status === 200 && data && data.status === 'ready' && data.database === 'connected') {
        recordPass(
          'Web Backend Database Readiness',
          `database connected via Prisma in ${elapsedMs}ms (reported DB latency: ${data.latencyMs}ms)`
        );
        return;
      }
      lastError = `HTTP ${status}: ${JSON.stringify(data)}`;
    } catch (err: any) {
      lastError = err.message;
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error(`Web backend readiness check failed after 3 attempts: ${lastError}`);
}

async function verifySocketServerReadiness(): Promise<{ gitCommit: string }> {
  const health = await httpGet(`${config.socketUrl}/health`);
  if (health.status !== 200 || !health.data || health.data.status !== 'ok') {
    throw new Error(`Socket server health failed: HTTP ${health.status} (${JSON.stringify(health.data)})`);
  }
  recordPass('Socket Server Health', `liveness OK, commit ${String(health.data.gitCommit || '').slice(0, 10)}`);

  const ready = await httpGet(`${config.socketUrl}/ready`);
  if (ready.status !== 200 || !ready.data || ready.data.status !== 'ready' || ready.data.database !== 'connected') {
    throw new Error(`Socket server database not connected: ${JSON.stringify(ready.data)}`);
  }
  recordPass('Socket Server Database Readiness', `connected to PostgreSQL (${ready.elapsedMs}ms)`);
  return { gitCommit: ready.data.gitCommit || '' };
}

async function verifySocketHandshake(): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error(`Socket connection timed out after ${config.timeoutMs}ms`));
    }, config.timeoutMs);

    const socket: Socket = io(config.socketUrl, {
      transports: ['websocket', 'polling'],
      timeout: config.timeoutMs,
      reconnection: false,
    });

    socket.on('connect', () => {
      clearTimeout(timer);
      recordPass('Socket.IO Handshake', `connected successfully (socketId: ${socket.id})`);
      socket.disconnect();
      resolve();
    });

    socket.on('connect_error', (err) => {
      clearTimeout(timer);
      socket.disconnect();
      if (err.message.includes('Missing token') || err.message.includes('Authentication error')) {
        recordPass('Socket.IO Auth Boundary', `TLS handshake verified, auth guard correctly enforces token requirement ("${err.message}")`);
        resolve();
      } else {
        reject(new Error(`Socket connection failed: ${err.message}`));
      }
    });
  });
}

async function verifyDoctorListingAndSlots(): Promise<void> {
  const doctorsRes = await httpGet(`${config.webUrl}/api/doctors`);
  if (doctorsRes.status !== 200 || !Array.isArray(doctorsRes.data)) {
    throw new Error(`Doctor listing returned HTTP ${doctorsRes.status}: expected array`);
  }
  if (doctorsRes.data.length === 0) {
    throw new Error('Doctor listing returned empty array');
  }

  const sampleDoctor = doctorsRes.data[0];
  if (!sampleDoctor.id || !sampleDoctor.name || !sampleDoctor.specialty) {
    throw new Error(`Doctor schema invalid: missing required fields in ${JSON.stringify(sampleDoctor)}`);
  }
  recordPass(
    'Doctor Search & Listing',
    `retrieved ${doctorsRes.data.length} registered doctors with valid schemas (sample: ${sampleDoctor.name}, ${sampleDoctor.specialty})`
  );

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = tomorrow.toISOString().split('T')[0];

  const slotsRes = await httpGet(`${config.webUrl}/api/doctors/${sampleDoctor.id}/slots?date=${dateStr}`);
  if (slotsRes.status !== 200 || !slotsRes.data || !Array.isArray(slotsRes.data.slots)) {
    throw new Error(`Slot retrieval for doctor ${sampleDoctor.id} returned HTTP ${slotsRes.status}`);
  }
  recordPass(
    'Doctor Slot Retrieval',
    `queried slots for doctor ${sampleDoctor.name} on ${dateStr} (${slotsRes.data.slots.length} slots returned)`
  );
}

async function verifyAuthBoundaries(): Promise<void> {
  const notifRes = await httpGet(`${config.webUrl}/api/user/unauthorized-ci-probe/notification`);
  if (notifRes.status !== 401 && notifRes.status !== 403) {
    throw new Error(`Notification endpoint returned unexpected HTTP ${notifRes.status} for unauthenticated probe`);
  }
  recordPass('Notification Auth Boundary', `unauthorized read safely rejected with HTTP ${notifRes.status}`);

  const docRes = await httpGet(`${config.webUrl}/api/patients/me/medical-documents`);
  if (docRes.status !== 401 && docRes.status !== 403) {
    throw new Error(`Medical documents returned unexpected HTTP ${docRes.status} for unauthenticated probe`);
  }
  recordPass('Medical Document Auth Boundary', `unauthorized read safely rejected with HTTP ${docRes.status}`);
}

function verifyCanonicalTimeCalculations(): void {
  const testCases = [
    { date: '2028-06-05', time: '10:00', expectedUtc: '2028-06-05T04:30:00.000Z', expectedDisplay: '10:00 AM IST' },
    { date: '2028-06-05', time: '14:00', expectedUtc: '2028-06-05T08:30:00.000Z', expectedDisplay: '2:00 PM IST' },
    { date: '2028-06-05', time: '23:50', expectedUtc: '2028-06-05T18:20:00.000Z', expectedDisplay: '11:50 PM IST' },
  ];

  for (const tc of testCases) {
    const computedUtc = localDateAndTimeToUtc(tc.date, tc.time, DEFAULT_CLINIC_TIMEZONE);
    if (computedUtc.toISOString() !== tc.expectedUtc) {
      throw new Error(`Timezone UTC conversion failed for ${tc.date} ${tc.time}: got ${computedUtc.toISOString()}, expected ${tc.expectedUtc}`);
    }
    const formattedDisplay = formatAppointmentTime(computedUtc, DEFAULT_CLINIC_TIMEZONE);
    if (formattedDisplay !== tc.expectedDisplay) {
      throw new Error(`Timezone display format failed: got "${formattedDisplay}", expected "${tc.expectedDisplay}"`);
    }
  }
  recordPass('Canonical Timezone Invariants', 'Asia/Kolkata wall time -> UTC DB instant -> UI display match verified');
}

function writeSummary() {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;

  let markdown = '### Quick-Clinic Post-Deployment Verification\n\n';
  markdown += '| Check | Status | Details |\n';
  markdown += '|---|---|---|\n';
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⚠️';
    markdown += `| ${r.name} | ${icon} ${r.status} | ${r.detail.replace(/\|/g, '/')} |\n`;
  }
  markdown += '\n';

  try {
    fs.appendFileSync(summaryPath, markdown, 'utf-8');
  } catch (err) {
    console.warn('Could not write GITHUB_STEP_SUMMARY:', err);
  }
}

export async function main(): Promise<number> {
  console.log('\x1b[34m======================================================\x1b[0m');
  console.log('\x1b[34m🏥 Quick-Clinic Production Deployment Smoke Suite\x1b[0m');
  console.log('\x1b[34m======================================================\x1b[0m');
  console.log(`Web URL:    ${config.webUrl}`);
  console.log(`Socket URL: ${config.socketUrl}\n`);

  try {
    await verifyFrontendAccessibility();
    await verifyWebBackendReadiness();
    await verifySocketServerReadiness();
    await verifySocketHandshake();
    await verifyDoctorListingAndSlots();
    await verifyAuthBoundaries();
    verifyCanonicalTimeCalculations();

    console.log('\n\x1b[32m======================================================\x1b[0m');
    console.log('\x1b[32m🎉 ALL QUICK-CLINIC PRODUCTION TESTS PASSED\x1b[0m');
    console.log('\x1b[32m======================================================\x1b[0m');
    return 0;
  } catch (err: any) {
    recordFail('Deployment Smoke Suite', err.message);
    console.error('\n\x1b[31m======================================================\x1b[0m');
    console.error(`\x1b[31m💥 SMOKE SUITE FAILED:\x1b[0m ${err.message}`);
    console.error('\x1b[31m======================================================\x1b[0m');
    return 1;
  } finally {
    writeSummary();
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch(() => process.exit(1));
}
