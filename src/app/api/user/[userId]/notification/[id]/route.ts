import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ userId: string; id: string }> }
) {
  try {
    const { userId, id } = await params;

    // Verify notification belongs to user
    const existing = await prisma.notification.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized or not found" },
        { status: 403 }
      );
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: {
        isRead: true,
        status: "READ",
        readAt: new Date(),
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.log("PUT ERROR:", err);
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  try {
    const { id, userId } = await params;

    // Verify notification belongs to user
    const existing = await prisma.notification.findUnique({
      where: { id },
    });

    if (!existing || existing.userId !== userId) {
      return NextResponse.json(
        { error: "Unauthorized or not found" },
        { status: 403 }
      );
    }

    await prisma.notification.delete({
      where: { id },
    });

    return NextResponse.json({ message: "Notification deleted" });
  } catch (err) {
    console.log("DELETE ERROR:", err);
    return NextResponse.json(
      { error: "Failed to delete notification" },
      { status: 500 }
    );
  }
}
