import { jwtVerify, SignJWT } from "jose";

function getSecretKey() {
  const secret = process.env.JWT_SECRET || "default_test_secret_for_jwt_auth_32_characters_minimum";
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
    const { payload } = await jwtVerify(token, getSecretKey());
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

export async function getAuthenticatedUser(req: Request): Promise<AuthenticatedUser | null> {
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
        token = decodeURIComponent(match[1]);
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

  return {
    id: userId,
    role: p.role || "PATIENT",
    email: p.email,
    name: p.name,
  };
}

export async function requireAdmin(req: Request) {
  const user = await getAuthenticatedUser(req);
  if (!user || user.role !== "ADMIN") {
    return null;
  }
  return user as { id: string; role: string; email: string; name: string };
}
