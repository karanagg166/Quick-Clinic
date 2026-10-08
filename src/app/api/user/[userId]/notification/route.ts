import { getAuthenticatedUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { NextResponse,NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
    if (!authUser) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { userId } = await params;
    if (authUser.role !== "ADMIN" && userId !== authUser.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 }
      );
    }

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(notifications, { status: 200 });
  } catch (err: any) {
    console.error("notification-get-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}
