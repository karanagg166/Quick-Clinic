import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {verifyToken} from "@/lib/auth";

const ROLE_ROUTES: Record<string, RegExp[]> = { 
  admin: [/^\/admin/],
   doctor: [/^\/doctor/],
    patient: [/^\/patient/],
};
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // 1. Public free paths
  if (
    pathname.startsWith("/user/login") ||
    pathname.startsWith("/user/signup") ||
    pathname.startsWith("/public") ||
    pathname.startsWith("/api/auth")
  ) {
    return NextResponse.next();
  }

  // 2. Skip for API routes
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // 3. Get token
  const token = request.cookies.get("token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/user/login", request.url));
  }

  // 4. Verify token
  const result = await verifyToken(token);

  if (!result.valid) {
    return NextResponse.redirect(new URL("/user/login", request.url));
  }

  const role = (result.payload as any).role;

  // 5. Role route check
  const allowedRoutes = ROLE_ROUTES[role] || [];

  const hasAccess = allowedRoutes.some((regex) => regex.test(pathname));

  if (!hasAccess) {
    return NextResponse.redirect(new URL("/unauthorized", request.url));
  }

  return NextResponse.next();
}
export const config = {
  matcher: ["/admin/:path*", "/doctor/:path*", "/patient/:path*"],
};
