import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from './src/lib/auth';

const ROLE_ROUTES: Record<string, RegExp[]> = {
  admin: [/^\/admin/],
  doctor: [/^\/doctor/],
  patient: [/^\/patient/],
};

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const token = request.cookies.get('Authtoken')?.value;

  if (!token) {
    return NextResponse.redirect(new URL('/user/login', request.url));
  }

  const result = await verifyToken(token);
  if (!result.valid) {
    return NextResponse.redirect(new URL('/user/login', request.url));
  }

  const role = (result.payload as any).role;

  if (role && ROLE_ROUTES[role]) {
    const hasAccess = ROLE_ROUTES[role].some(pattern => pattern.test(pathname));
    if (!hasAccess) {
      return NextResponse.redirect(new URL('/unauthorized', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/(admin|doctor|patient)/:path*'],
};