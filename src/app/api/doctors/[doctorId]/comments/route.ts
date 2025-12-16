import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/auth";

export async function POST(req: NextRequest, { params }: { params: Promise<{ doctorId: string }> }) {
  try {
    const { doctorId } = await params;
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const cookieToken = req.cookies.get("token")?.value;
    const actualToken = token || cookieToken;

    if (!actualToken) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const { valid, userId } = await getUserId(actualToken);
    if (!valid || !userId) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const text = (body?.text || "").trim();
    const parentId = body?.parentId ? String(body.parentId) : null;

    if (!text) {
      return NextResponse.json({ message: "Comment text is required" }, { status: 400 });
    }

    // Ensure doctor exists
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) {
      return NextResponse.json({ message: "Doctor not found" }, { status: 404 });
    }

    // Optionally ensure parent exists and matches doctor
    if (parentId) {
      const parent = await prisma.comment.findUnique({ where: { id: parentId } });
      if (!parent || parent.doctorId !== doctorId) {
        return NextResponse.json({ message: "Invalid parent comment" }, { status: 400 });
      }
    }

    const created = await prisma.comment.create({
      data: {
        doctorId,
        userId,
        text,
        parentId,
      },
      include: {
        user: { select: { id: true, name: true, profileImageUrl: true } },
      },
    });

    return NextResponse.json({ comment: created });
  } catch (error: any) {
    console.error("comment-post-error", error);
    return NextResponse.json({ message: error?.message || "Server error" }, { status: 500 });
  }
}
