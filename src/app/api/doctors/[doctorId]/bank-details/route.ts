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
      include: {
        user: {
          include: {
            bankAccounts: true,
          },
        },
      },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    const bankAccount = doctor.user?.bankAccounts?.[0] || null;

    return NextResponse.json(
      {
        bankAccountNumber: bankAccount?.bankAccountNumber || null,
        bankIFSC: bankAccount?.bankIFSC || null,
        bankAccountHolderName: bankAccount?.bankAccountHolderName || null,
        bankName: bankAccount?.bankName || null,
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

    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: { userId: true },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
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
    if (!ifscRegex.test(bankIFSC.toUpperCase().trim())) {
      return NextResponse.json(
        { error: "Invalid IFSC code format" },
        { status: 400 }
      );
    }

    // Validate account number (should be numeric and at least 9 digits)
    if (!/^\d{9,18}$/.test(String(bankAccountNumber).trim())) {
      return NextResponse.json(
        { error: "Invalid account number" },
        { status: 400 }
      );
    }

    // Find existing bank account for user
    const existing = await prisma.bankAccount.findFirst({
      where: { userId: doctor.userId },
    });

    let bankAccount;
    if (existing) {
      bankAccount = await prisma.bankAccount.update({
        where: { id: existing.id },
        data: {
          bankAccountNumber: String(bankAccountNumber).trim(),
          bankIFSC: bankIFSC.toUpperCase().trim(),
          bankAccountHolderName: bankAccountHolderName.trim(),
          bankName: bankName.trim(),
        },
      });
    } else {
      bankAccount = await prisma.bankAccount.create({
        data: {
          userId: doctor.userId,
          bankAccountNumber: String(bankAccountNumber).trim(),
          bankIFSC: bankIFSC.toUpperCase().trim(),
          bankAccountHolderName: bankAccountHolderName.trim(),
          bankName: bankName.trim(),
        },
      });
    }

    return NextResponse.json(
      {
        message: "Bank details updated successfully",
        bankDetails: {
          bankAccountNumber: bankAccount.bankAccountNumber,
          bankIFSC: bankAccount.bankIFSC,
          bankAccountHolderName: bankAccount.bankAccountHolderName,
          bankName: bankAccount.bankName,
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
