import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // 1. Admin Route Protection
    if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
        // Note: Assuming /admin/login exists or user login handles it. 
        // If admin uses generic /auth/login, we just protect the dashboard.
        // Assuming /admin/onboarding needs access but might be public? 
        // No, user said onboarding is for logged in users requesting admin.

        const token = request.cookies.get('token')?.value;

        if (!token) {
            // Redirect to login if no token
            return NextResponse.redirect(new URL('/auth/login', request.url));
        }

        const { valid, payload } = await verifyToken(token);

        if (!valid || !payload) {
            return NextResponse.redirect(new URL('/auth/login', request.url));
        }

        if ((payload as any).role !== "ADMIN") {
            // Redirect to unauthorized page or back to home
            return NextResponse.redirect(new URL('/unauthorized', request.url));
        }
    }

    // 2. Doctor/Patient Protections (Optional, can add later if requested)
    // ...

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/admin/:path*',
        // Add other protected routes
    ],
};
