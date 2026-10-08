import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";

// GET - Fetch doctor balance
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        userId: true,
        balance: true,
        fees: true,
      },
    });

    if (!doctor) {
      return NextResponse.json(
        {
          balance: 0,
          balanceInRupees: 0,
          fees: 0,
        },
        { status: 200 }
      );
    }

    if (authUser.role !== "ADMIN" && (authUser.role !== "DOCTOR" || doctor.userId !== authUser.id)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rawBalance = doctor.balance ?? 0;
    const balanceInRupees = rawBalance / 100;

    return NextResponse.json(
      {
        balance: rawBalance, // In paise
        balanceInRupees, // In rupees for display
        fees: doctor.fees ?? 0,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error fetching doctor balance:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch balance" },
      { status: 500 }
    );
  }
}
