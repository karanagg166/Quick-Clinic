import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET - Fetch doctor balance
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }

    // Try finding by doctor.id first, then fallback to userId
    let doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        balance: true,
        fees: true,
      },
    });


    if (!doctor) {
      // Return zero balance instead of 404 to prevent navbar errors
      return NextResponse.json(
        {
          balance: 0,
          balanceInRupees: 0,
          fees: 0,
        },
        { status: 200 }
      );
    }

    // Convert balance from paise to rupees (with null guard)
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

