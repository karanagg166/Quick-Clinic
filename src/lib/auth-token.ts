import { jwtVerify, SignJWT } from "jose";

export const TOKEN_AUDIENCE = {
  SESSION: "quick-clinic-session",
  SOCKET: "quick-clinic-socket",
} as const;

export interface AuthenticatedUser {
  id: string;
  role: string;
  email?: string;
  name?: string;
}

export function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(secret);
}

// CREATE TOKEN
export async function createToken(
  payload: Record<string, unknown>,
  expiresIn = "7d",
  audience?: string
) {
  const aud = (audience || payload.aud || TOKEN_AUDIENCE.SESSION) as string;
  const tokenPayload = { ...payload, aud };
  return new SignJWT(tokenPayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecretKey());
}

export interface VerifyTokenOptions {
  expectedAudience?: string;
  allowLegacyWithoutAud?: boolean;
}

// VERIFY TOKEN
export async function verifyToken(
  token: string,
  options?: VerifyTokenOptions
) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), {
      algorithms: ["HS256"],
      requiredClaims: ["exp"],
    });

    const expectedAud = options?.expectedAudience || TOKEN_AUDIENCE.SESSION;
    const allowLegacy = options?.allowLegacyWithoutAud ?? (expectedAud === TOKEN_AUDIENCE.SESSION);

    // If verifying for HTTP session, strictly reject socket tickets
    if (expectedAud === TOKEN_AUDIENCE.SESSION) {
      if (payload.aud === TOKEN_AUDIENCE.SOCKET) {
        return { valid: false, error: "Invalid token audience: socket ticket not allowed for HTTP session" };
      }
      if (payload.aud && payload.aud !== TOKEN_AUDIENCE.SESSION) {
        return { valid: false, error: "Invalid token audience" };
      }
      if (!payload.aud && !allowLegacy) {
        return { valid: false, error: "Missing required token audience" };
      }
    } else {
      // For any other expected audience (e.g. socket), audience must strictly match
      if (payload.aud !== expectedAud) {
        return { valid: false, error: `Invalid token audience: expected ${expectedAud}` };
      }
    }

    const id = payload.id ?? payload.userId;
    if (
      typeof id !== "string" ||
      !id.trim() ||
      (payload.id !== undefined && payload.userId !== undefined && payload.id !== payload.userId) ||
      typeof payload.role !== "string" ||
      !["PATIENT", "DOCTOR", "ADMIN"].includes(payload.role.toUpperCase())
    ) {
      return { valid: false, error: "Invalid identity claims" };
    }
    return { valid: true, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Token verification failed";
    return { valid: false, error: message };
  }
}

export async function getUserId(token: string) {
  const result = await verifyToken(token);
  if (!result.valid || !result.payload) return { valid: false, userId: null };
  const p = result.payload as Record<string, unknown>;
  return { valid: true, userId: (p.id || p.userId) as string };
}

interface RequestWithCookies {
  cookies?: {
    get(name: string): { value: string } | undefined;
  };
}

export function extractTokenFromRequest(req: Request): string | null {
  let token: string | undefined;

  // 1. NextRequest cookies
  const reqWithCookies = req as unknown as RequestWithCookies;
  if (reqWithCookies.cookies?.get) {
    token = reqWithCookies.cookies.get("token")?.value;
  }

  // 2. Cookie header
  if (!token && req.headers?.get) {
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
      if (match) {
        try {
          token = decodeURIComponent(match[1]);
        } catch {
          return null;
        }
      }
    }
  }

  // 3. Authorization header
  if (!token && req.headers?.get) {
    const authHeader = req.headers.get("authorization");
    if (authHeader && authHeader.startsWith("Bearer ")) {
      token = authHeader.substring(7).trim();
    }
  }

  return token || null;
}

export async function getAuthenticatedUserFromToken(
  req: Request
): Promise<AuthenticatedUser | null> {
  const token = extractTokenFromRequest(req);
  if (!token) return null;

  const result = await verifyToken(token);
  if (!result.valid || !result.payload) return null;

  const p = result.payload as Record<string, unknown>;
  const userId = p.id || p.userId;
  if (!userId || typeof userId !== "string") return null;

  if (!p.role || typeof p.role !== "string") {
    return null;
  }

  const normalizedRole = p.role.toUpperCase();
  if (!["PATIENT", "DOCTOR", "ADMIN"].includes(normalizedRole)) {
    return null;
  }

  return {
    id: userId,
    role: normalizedRole,
    email: typeof p.email === "string" ? p.email : undefined,
    name: typeof p.name === "string" ? p.name : undefined,
  };
}
