import {
  AuthenticatedUser,
  createToken,
  extractTokenFromRequest,
  getAuthenticatedUserFromToken,
  getSecretKey,
  getUserId,
  verifyToken,
} from "./auth-token";

export type { AuthenticatedUser };
export { createToken, extractTokenFromRequest, getAuthenticatedUserFromToken, getSecretKey, getUserId, verifyToken };

export interface GetAuthenticatedUserOptions {
  verifyDb?: boolean;
}

export async function getAuthenticatedUser(
  req: Request,
  options?: GetAuthenticatedUserOptions
): Promise<AuthenticatedUser | null> {
  const user = await getAuthenticatedUserFromToken(req);
  if (!user) return null;

  if (options?.verifyDb) {
    try {
      const { prisma } = await import("@/lib/prisma");
      const dbUser = await prisma.user.findUnique({
        where: { id: user.id },
        select: { id: true, role: true, email: true, name: true, isActive: true },
      });
      if (!dbUser || !dbUser.isActive) return null;
      if (dbUser.role !== user.role) {
        return null;
      }
      return {
        id: dbUser.id,
        role: dbUser.role,
        email: dbUser.email,
        name: dbUser.name,
      };
    } catch {
      return null;
    }
  }

  return user;
}

export async function requireAdmin(req: Request, options?: GetAuthenticatedUserOptions) {
  const user = await getAuthenticatedUser(req, options);
  if (!user || user.role !== "ADMIN") {
    return null;
  }
  return user as { id: string; role: string; email: string; name: string };
}
