import { describe, it, expect } from 'vitest';
import { createToken, verifyToken, getUserId, requireAdmin } from '@/lib/auth';

describe('auth utilities', () => {
  it('creates and verifies a valid JWT', async () => {
    const payload = { id: 'user_123', role: 'PATIENT', email: 'test@example.com' };
    const token = await createToken(payload);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(20);

    const verified = await verifyToken(token);
    expect(verified.valid).toBe(true);
    expect(verified.payload).toHaveProperty('id', 'user_123');
    expect(verified.payload).toHaveProperty('role', 'PATIENT');
  });

  it('rejects invalid or tampered tokens', async () => {
    const res = await verifyToken('invalid.jwt.token');
    expect(res.valid).toBe(false);
    expect(res).toHaveProperty('error');
  });

  it('getUserId extracts user ID from valid token', async () => {
    const token = await createToken({ id: 'user_456', role: 'DOCTOR' });
    const { valid, userId } = await getUserId(token);
    expect(valid).toBe(true);
    expect(userId).toBe('user_456');
  });

  it('getUserId returns valid=false for bad token', async () => {
    const { valid, userId } = await getUserId('bad_token');
    expect(valid).toBe(false);
    expect(userId).toBeNull();
  });

  it('requireAdmin allows admin user', async () => {
    const token = await createToken({ id: 'admin_1', role: 'ADMIN', email: 'admin@clinic.com', name: 'Super Admin' });
    const req = {
      cookies: {
        get: (name: string) => (name === 'token' ? { value: token } : undefined),
      },
    } as any;

    const admin = await requireAdmin(req);
    expect(admin).not.toBeNull();
    expect(admin?.role).toBe('ADMIN');
    expect(admin?.id).toBe('admin_1');
  });

  it('requireAdmin rejects non-admin user', async () => {
    const token = await createToken({ id: 'doc_1', role: 'DOCTOR', email: 'doc@clinic.com', name: 'Dr Smith' });
    const req = {
      cookies: {
        get: (name: string) => (name === 'token' ? { value: token } : undefined),
      },
    } as any;

    const admin = await requireAdmin(req);
    expect(admin).toBeNull();
  });

  it('requireAdmin returns null when token is missing', async () => {
    const req = {
      cookies: {
        get: () => undefined,
      },
    } as any;

    const admin = await requireAdmin(req);
    expect(admin).toBeNull();
  });
});
