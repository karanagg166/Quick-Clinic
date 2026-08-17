import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { POST as sendOtpPOST } from '@/app/api/user/[userId]/otp/send/route';
import { prisma } from '@/lib/prisma';
import { resend } from '@/lib/resend';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    otp: {
      upsert: vi.fn(),
    },
  },
}));

vi.mock('@/lib/resend', () => ({
  resend: {
    emails: {
      send: vi.fn(),
    },
  },
}));

describe('Phase 80: Email Service Boundary & OTP Dispatch Test Suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('80.1 Generates 6-digit OTP and sends email via Resend successfully', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      email: 'verified_patient@quickclinic.test',
    } as any);

    vi.mocked(prisma.otp.upsert).mockResolvedValueOnce({
      id: 'otp_1',
      email: 'verified_patient@quickclinic.test',
      userId: 'user_otp_1',
      code: '849201',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      createdAt: new Date(),
    });

    vi.mocked(resend.emails.send).mockResolvedValueOnce({
      data: { id: 'email_msg_123' },
      error: null,
    } as any);

    const req = new NextRequest('http://localhost:3000/api/user/user_otp_1/otp/send', {
      method: 'POST',
    });

    const res = await sendOtpPOST(req, { params: Promise.resolve({ userId: 'user_otp_1' }) });
    expect(res.status).toBe(200);

    expect(prisma.otp.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'verified_patient@quickclinic.test' },
        create: expect.objectContaining({
          email: 'verified_patient@quickclinic.test',
          userId: 'user_otp_1',
          code: expect.stringMatching(/^\d{6}$/),
        }),
      })
    );

    expect(resend.emails.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'verified_patient@quickclinic.test',
        subject: 'Your OTP Code',
      })
    );
  });

  it('80.2 Returns 404 when user has no registered email', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

    const req = new NextRequest('http://localhost:3000/api/user/non_existent/otp/send', {
      method: 'POST',
    });

    const res = await sendOtpPOST(req, { params: Promise.resolve({ userId: 'non_existent' }) });
    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.message).toMatch(/User email not found/i);
  });

  it('80.3 Fallback safely in development environment if external email provider rejects request', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      email: 'dev_test@quickclinic.test',
    } as any);

    vi.mocked(prisma.otp.upsert).mockResolvedValueOnce({
      id: 'otp_dev',
      email: 'dev_test@quickclinic.test',
      userId: 'user_dev_1',
      code: '123456',
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      createdAt: new Date(),
    });

    vi.mocked(resend.emails.send).mockRejectedValueOnce(new Error('Resend domain not verified'));

    const req = new NextRequest('http://localhost:3000/api/user/user_dev_1/otp/send', {
      method: 'POST',
    });

    const res = await sendOtpPOST(req, { params: Promise.resolve({ userId: 'user_dev_1' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.otp).toBe('123456');
  });
});
