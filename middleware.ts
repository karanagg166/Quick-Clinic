import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/auth";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Public routes
  const publicRoutes = [
    "/user/login",
    "/user/signup",
    "/public",
    "/api/auth"
  ];

  // Allow public pages
  if (publicRoutes.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Skip API routes (unless you want to protect them)
  if (pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Get JWT token from cookies
  const token = request.cookies.get("token")?.value;

  if (!token) {
    return NextResponse.redirect(new URL("/user/login", request.url));
  }

  // Verify token
  const result = await verifyToken(token);

  if (!result.valid) {
    return NextResponse.redirect(new URL("/user/login", request.url));
  }

  // If token is valid → allow access
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/doctor/:path*", "/patient/:path*"],
};
