import { jwtVerify, SignJWT } from "jose";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("Missing JWT_SECRET");

const secretKey = new TextEncoder().encode(JWT_SECRET);

// CREATE TOKEN
export async function createToken(payload: Record<string, any>) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secretKey);
}

// VERIFY TOKEN
export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, secretKey);
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
