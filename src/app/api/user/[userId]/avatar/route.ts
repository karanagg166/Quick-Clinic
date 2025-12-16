import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getUserId } from '@/lib/auth';


export async function GET(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {

    try {
        const { userId } = await params;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { profileImageUrl: true },
        });

        if (!user) {
            return NextResponse.json({ message: "User not found" }, { status: 404 });
        }

        if (!user.profileImageUrl) {
            return NextResponse.json({ message: "Avatar not found" }, { status: 404 });
        }

        return NextResponse.json({ avatarUrl: user.profileImageUrl });

    }
    catch (error: any) {
        console.error("Error fetching avatar:", error);
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
}



export async function POST(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {

    try {
        const { userId } = await params;

        // Auth: only the owner can update their avatar
        const authHeader = request.headers.get('authorization');
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
        if (!token) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        const { valid, userId: requesterId } = await getUserId(token);
        if (!valid || requesterId !== userId) {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
        });

        if (!user) {
            return NextResponse.json({ message: "User not found" }, { status: 404 });
        }

        const body = await request.json();
        const avatarUrl = body?.avatarUrl ?? body?.url;
        if (typeof avatarUrl !== 'string' || avatarUrl.length === 0) {
            return NextResponse.json({ message: 'Invalid avatar URL' }, { status: 400 });
        }

        const updatedUser = await prisma.user.update({
            where: { id: userId },
            data: { profileImageUrl: avatarUrl },
            select: { profileImageUrl: true },
        });

        return NextResponse.json({ avatarUrl: updatedUser.profileImageUrl });

    }
    catch (error: any) {
        console.error("Error updating avatar:", error);
        return NextResponse.json({ message: error.message }, { status: 500 });
    }
}