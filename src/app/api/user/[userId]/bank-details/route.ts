import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";

// GET - Fetch user bank details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bankAccount = await prisma.bankAccount.findFirst({
      where: { userId },
    });

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
    console.error("Error fetching user bank details:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch bank details" },
      { status: 500 }
    );
  }
}

// PATCH - Update/Create user bank details
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;

    if (!userId) {
      return NextResponse.json({ error: "userId is required" }, { status: 400 });
    }

    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
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

    // Validate account number (should be numeric and between 9 to 18 digits)
    if (!/^\d{9,18}$/.test(String(bankAccountNumber).trim())) {
      return NextResponse.json(
        { error: "Invalid account number" },
        { status: 400 }
      );
    }

    // Find existing bank account for user
    const existing = await prisma.bankAccount.findFirst({
      where: { userId },
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
          userId,
          bankAccountNumber: String(bankAccountNumber).trim(),
          bankIFSC: bankIFSC.toUpperCase().trim(),
          bankAccountHolderName: bankAccountHolderName.trim(),
          bankName: bankName.trim(),
        },
      });
    }

    return NextResponse.json(
      {
        message: "Bank details saved successfully",
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
    console.error("Error saving user bank details:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save bank details" },
      { status: 500 }
    );
  }
}
