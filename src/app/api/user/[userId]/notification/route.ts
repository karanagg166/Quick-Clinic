import { prisma } from "@/lib/prisma";
import { NextResponse,NextRequest } from "next/server";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

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
