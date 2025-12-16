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
    const rating = Number(body?.rating);
    if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ message: "Rating must be between 1 and 5" }, { status: 400 });
    }

    // Ensure doctor exists
    const doctor = await prisma.doctor.findUnique({ where: { id: doctorId } });
    if (!doctor) {
      return NextResponse.json({ message: "Doctor not found" }, { status: 404 });
    }

    // Upsert rating for this user/doctor
    await prisma.rating.upsert({
      where: { doctorId_userId: { doctorId, userId } },
      update: { rating },
      create: { doctorId, userId, rating },
    });

    // Return updated aggregate
    const agg = await prisma.rating.aggregate({
      where: { doctorId },
      _avg: { rating: true },
      _count: { rating: true },
    });

    return NextResponse.json({
      rating: {
        average: agg._avg.rating ? Number(agg._avg.rating.toFixed(1)) : 0,
        count: agg._count.rating ?? 0,
      },
    });
  } catch (error: any) {
    console.error("rating-post-error", error);
    return NextResponse.json({ message: error?.message || "Server error" }, { status: 500 });
  }
}
