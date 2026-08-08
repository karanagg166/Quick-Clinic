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

export async function requireAdmin(req: Request) {
  const cookieStore = (req as any).cookies;
  const token = cookieStore?.get("token")?.value;

  if (!token) {
    return null;
  }

  const { valid, payload } = await verifyToken(token);

  if (!valid || !payload) {
    return null;
  }

  // Check role in payload
  if ((payload as any).role !== "ADMIN") {
    return null;
  }

  return payload as { id: string; role: string; email: string; name: string };
}
