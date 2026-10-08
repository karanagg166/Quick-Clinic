import { jwtVerify, SignJWT } from "jose";

function getSecretKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET is required");
  return new TextEncoder().encode(secret);
}

// CREATE TOKEN
export async function createToken(payload: Record<string, any>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getSecretKey());
}

// VERIFY TOKEN
export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, getSecretKey(), { algorithms: ["HS256"], requiredClaims: ["exp"] });
    const id = payload.id ?? payload.userId;
    if (typeof id !== "string" || !id.trim() ||
        (payload.id !== undefined && payload.userId !== undefined && payload.id !== payload.userId) ||
        typeof payload.role !== "string" || !["PATIENT", "DOCTOR", "ADMIN"].includes(payload.role.toUpperCase())) {
      return { valid: false, error: "Invalid identity claims" };
    }
    return { valid: true, payload };
  } catch (err: any) {
    return { valid: false, error: err?.message };
  }
}

export async function getUserId(token: string) {
  const result = await verifyToken(token);
  if (!result.valid) return { valid: false, userId: null };
  return { valid: true, userId: (result.payload as any).id };
}

export interface AuthenticatedUser {
  id: string;
  role: string;
  email?: string;
  name?: string;
}

export interface GetAuthenticatedUserOptions {
  verifyDb?: boolean;
}

export async function getAuthenticatedUser(
  req: Request,
  options?: GetAuthenticatedUserOptions
): Promise<AuthenticatedUser | null> {
  let token: string | undefined;

  // 1. NextRequest cookies
  if ((req as any).cookies?.get) {
    token = (req as any).cookies.get("token")?.value;
  }

  // 2. Cookie header
  if (!token && req.headers?.get) {
    const cookieHeader = req.headers.get("cookie");
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
      if (match) {
        try { token = decodeURIComponent(match[1]); } catch { return null; }
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

  if (!token) return null;

  const result = await verifyToken(token);
  if (!result.valid || !result.payload) return null;

  const p = result.payload as any;
  const userId = p.id || p.userId;
  if (!userId) return null;

  // Authoritative identity: missing or invalid role claim must fail authentication, never fallback
  if (!p.role || typeof p.role !== "string") {
    return null;
  }

  const normalizedRole = p.role.toUpperCase();
  if (!["PATIENT", "DOCTOR", "ADMIN"].includes(normalizedRole)) {
    return null;
  }

  let role = normalizedRole;
  let email = p.email;
  let name = p.name;

  if (options?.verifyDb) {
    try {
      const { prisma } = await import("@/lib/prisma");
      const dbUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, email: true, name: true, isActive: true },
      });
      if (!dbUser || !dbUser.isActive) return null;
      if (dbUser.role !== normalizedRole) {
        return null;
      }
      role = dbUser.role;
      email = dbUser.email;
      name = dbUser.name;
    } catch {
      return null;
    }
  }

  return {
    id: userId,
    role,
    email,
    name,
  };
}

export async function requireAdmin(req: Request, options?: GetAuthenticatedUserOptions) {
  const user = await getAuthenticatedUser(req, options);
  if (!user || user.role !== "ADMIN") {
    return null;
  }
  return user as { id: string; role: string; email: string; name: string };
}
