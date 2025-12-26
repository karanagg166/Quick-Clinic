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

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        balance: true,
        fees: true,
      },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    // Convert balance from paise to rupees
    const balanceInRupees = doctor.balance / 100;

    return NextResponse.json(
      {
        balance: doctor.balance, // In paise
        balanceInRupees, // In rupees for display
        fees: doctor.fees,
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

