import {prisma} from "@/lib/prisma";
import { NextResponse } from "next/server";

export async function PUT(
  req: Request,
  { params }: { params: { userId: string; id: string } }
) {
  try {
    const updated = await prisma.notification.update({
      where: { id: params.id,
        userId: params.userId,
      },
      data: {
        isRead: true,
        status: "READ",
        readAt: new Date(),
      },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.log(err);
    return NextResponse.json(
      { error: "Failed to update notification" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await prisma.notification.delete({
      where: { id: params.id,
        userId: params.userId,
      },
    });

    return NextResponse.json({ message: "Notification deleted" });
  } catch (err) {
    console.log(err);
    return NextResponse.json(
      { error: "Failed to delete notification" },
      { status: 500 }
    );
  }
}