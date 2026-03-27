import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 1. Admin Route Protection
    if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
        const token = request.cookies.get('token')?.value;

        if (!token) {
            return NextResponse.redirect(new URL('/auth/login', request.url));
        }

        const { valid, payload } = await verifyToken(token);

        if (!valid || !payload) {
            return NextResponse.redirect(new URL('/auth/login', request.url));
        }

        if ((payload as Record<string, unknown>).role !== "ADMIN") {
            return NextResponse.redirect(new URL('/unauthorized', request.url));
        }
    }

    // 2. Doctor Route Protection
    if (pathname.startsWith('/doctor') && !pathname.startsWith('/doctor/login')) {
        const token = request.cookies.get('token')?.value;
        if (!token) return NextResponse.redirect(new URL('/auth/login', request.url));

        const { valid, payload } = await verifyToken(token);
        if (!valid || !payload) return NextResponse.redirect(new URL('/auth/login', request.url));

        if ((payload as Record<string, unknown>).role !== "DOCTOR") {
            return NextResponse.redirect(new URL('/unauthorized', request.url));
        }
    }

    // 3. Patient Route Protection
    if (pathname.startsWith('/patient') && !pathname.startsWith('/patient/login')) {
        const token = request.cookies.get('token')?.value;
        if (!token) return NextResponse.redirect(new URL('/auth/login', request.url));

        const { valid, payload } = await verifyToken(token);
        if (!valid || !payload) return NextResponse.redirect(new URL('/auth/login', request.url));

        if ((payload as Record<string, unknown>).role !== "PATIENT") {
            return NextResponse.redirect(new URL('/unauthorized', request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/admin/:path*',
        '/doctor/:path*',
        '/patient/:path*',
    ],
};
