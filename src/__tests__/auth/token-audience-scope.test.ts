import { describe, it, expect, beforeEach } from 'vitest';
import { createToken, verifyToken, TOKEN_AUDIENCE } from '@/lib/auth-token';
import { getAuthenticatedUser } from '@/lib/auth';
import { NextRequest } from 'next/server';

describe('Token Purpose, Audience Separation & Ticket Scope', () => {
  const secret = process.env.JWT_SECRET || 'test_jwt_secret_must_be_long_enough_for_hs256';

  beforeEach(() => {
    process.env.JWT_SECRET = secret;
  });

  it('createToken defaults to SESSION audience', async () => {
    const token = await createToken({ id: 'user_1', role: 'PATIENT' });
    const result = await verifyToken(token);
    expect(result.valid).toBe(true);
    expect(result.payload?.aud).toBe(TOKEN_AUDIENCE.SESSION);
  });

  it('HTTP session verification accepts valid SESSION audience tokens', async () => {
    const sessionToken = await createToken(
      { id: 'user_1', role: 'PATIENT', aud: TOKEN_AUDIENCE.SESSION },
      '1h'
    );
    const result = await verifyToken(sessionToken);
    expect(result.valid).toBe(true);
    expect(result.payload?.id).toBe('user_1');
    expect(result.payload?.aud).toBe(TOKEN_AUDIENCE.SESSION);
  });

  it('HTTP session verification preserves backward compatibility for legacy session tokens without audience', async () => {
    const legacyToken = await createToken(
      { id: 'legacy_user', role: 'PATIENT' },
      '1h'
    );
    // Explicitly strip aud claim to simulate pre-existing active session token
    const parts = legacyToken.split('.');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    delete payload.aud;
    const crypto = await import('crypto');
    const newPayloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${parts[0]}.${newPayloadB64}`)
      .digest('base64url');
    const rawLegacyToken = `${parts[0]}.${newPayloadB64}.${signature}`;

    const result = await verifyToken(rawLegacyToken);
    expect(result.valid).toBe(true);
    expect(result.payload?.id).toBe('legacy_user');
  });

  it('HTTP session verification strictly rejects socket tickets (aud: quick-clinic-socket)', async () => {
    const socketTicket = await createToken(
      { id: 'user_attacker', role: 'PATIENT', aud: TOKEN_AUDIENCE.SOCKET },
      '10m'
    );

    // Verify token for HTTP session context
    const result = await verifyToken(socketTicket, { expectedAudience: TOKEN_AUDIENCE.SESSION });
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/socket ticket not allowed for HTTP session/i);

    // Default verifyToken also rejects SOCKET audience
    const defaultResult = await verifyToken(socketTicket);
    expect(defaultResult.valid).toBe(false);
    expect(defaultResult.error).toMatch(/socket ticket not allowed/i);
  });

  it('HTTP verification rejects unknown/arbitrary audience tokens', async () => {
    const bogusToken = await createToken(
      { id: 'user_1', role: 'PATIENT', aud: 'untrusted-third-party-aud' },
      '1h'
    );
    const result = await verifyToken(bogusToken);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Invalid token audience/i);
  });

  it('HTTP verification rejects expired tokens', async () => {
    const expiredToken = await createToken(
      { id: 'user_1', role: 'PATIENT', exp: Math.floor(Date.now() / 1000) - 30 },
      '0s'
    );
    const result = await verifyToken(expiredToken);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/expired|timestamp check failed/i);
  });

  it('HTTP verification rejects tampered signature', async () => {
    const validToken = await createToken({ id: 'user_1', role: 'PATIENT' });
    const tampered = validToken.slice(0, -6) + 'abcdef';
    const result = await verifyToken(tampered);
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/signature verification failed/i);
  });

  it('getAuthenticatedUser rejects socket ticket presented in Authorization header', async () => {
    const socketTicket = await createToken(
      { id: 'user_socket_owner', role: 'PATIENT', aud: TOKEN_AUDIENCE.SOCKET },
      '10m'
    );

    const req = new NextRequest('http://localhost:3000/api/patient/appointments', {
      headers: {
        Authorization: `Bearer ${socketTicket}`,
      },
    });

    const user = await getAuthenticatedUser(req, { verifyDb: false });
    expect(user).toBeNull();
  });

  it('getAuthenticatedUser rejects socket ticket presented in token cookie', async () => {
    const socketTicket = await createToken(
      { id: 'user_socket_owner', role: 'PATIENT', aud: TOKEN_AUDIENCE.SOCKET },
      '10m'
    );

    const req = new NextRequest('http://localhost:3000/api/patient/appointments', {
      headers: {
        Cookie: `token=${socketTicket}`,
      },
    });

    const user = await getAuthenticatedUser(req, { verifyDb: false });
    expect(user).toBeNull();
  });

  it('getAuthenticatedUser accepts valid SESSION token in cookie or header', async () => {
    const sessionToken = await createToken(
      { id: 'valid_patient', role: 'PATIENT', aud: TOKEN_AUDIENCE.SESSION },
      '1h'
    );

    const req = new NextRequest('http://localhost:3000/api/patient/appointments', {
      headers: {
        Cookie: `token=${sessionToken}`,
      },
    });

    const user = await getAuthenticatedUser(req, { verifyDb: false });
    expect(user).not.toBeNull();
    expect(user?.id).toBe('valid_patient');
  });
});
