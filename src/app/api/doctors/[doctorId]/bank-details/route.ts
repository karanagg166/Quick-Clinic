import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET - Fetch doctor bank details
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
        bankAccountNumber: true,
        bankIFSC: true,
        bankAccountHolderName: true,
        bankName: true,
      },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    return NextResponse.json(
      {
        bankAccountNumber: doctor.bankAccountNumber || null,
        bankIFSC: doctor.bankIFSC || null,
        bankAccountHolderName: doctor.bankAccountHolderName || null,
        bankName: doctor.bankName || null,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error fetching bank details:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch bank details" },
      { status: 500 }
    );
  }
}

// PATCH - Update doctor bank details
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }

    const body = await req.json();
    const { bankAccountNumber, bankIFSC, bankAccountHolderName, bankName } = body;

    // Validation
    if (!bankAccountNumber || !bankIFSC || !bankAccountHolderName || !bankName) {
      return NextResponse.json(
        { error: "All bank details are required" },
        { status: 400 }
      );
    }

    // Validate IFSC format (11 characters: 4 letters + 0 + 6 alphanumeric)
    const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    if (!ifscRegex.test(bankIFSC.toUpperCase())) {
      return NextResponse.json(
        { error: "Invalid IFSC code format" },
        { status: 400 }
      );
    }

    // Validate account number (should be numeric and at least 9 digits)
    if (!/^\d{9,18}$/.test(bankAccountNumber)) {
      return NextResponse.json(
        { error: "Invalid account number" },
        { status: 400 }
      );
    }

    const doctor = await prisma.doctor.update({
      where: { id: doctorId },
      data: {
        bankAccountNumber: bankAccountNumber.trim(),
        bankIFSC: bankIFSC.toUpperCase().trim(),
        bankAccountHolderName: bankAccountHolderName.trim(),
        bankName: bankName.trim(),
      },
      select: {
        bankAccountNumber: true,
        bankIFSC: true,
        bankAccountHolderName: true,
        bankName: true,
      },
    });

    return NextResponse.json(
      {
        message: "Bank details updated successfully",
        bankDetails: {
          bankAccountNumber: doctor.bankAccountNumber,
          bankIFSC: doctor.bankIFSC,
          bankAccountHolderName: doctor.bankAccountHolderName,
          bankName: doctor.bankName,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error updating bank details:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to update bank details" },
      { status: 500 }
    );
  }
}

