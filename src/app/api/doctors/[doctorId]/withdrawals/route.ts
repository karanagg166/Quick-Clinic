import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";

export function maskAccountNumber(accountNumber?: string | null): string {
  if (!accountNumber) return "N/A";
  const trimmed = accountNumber.trim();
  if (trimmed.length <= 4) return trimmed;
  const last4 = trimmed.slice(-4);
  return `********${last4}`;
}

// GET - Fetch doctor withdrawal history
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

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const bankAccount = doctor.user?.bankAccounts?.[0] || null;

    const withdrawals = await prisma.withdrawal.findMany({
      where: { doctorId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      withdrawals.map((w: any) => ({
        id: w.id,
        amount: w.amount,
        amountInRupees: w.amount / 100, // Convert from paise to rupees
        currency: w.currency,
        status: w.status,
        bankAccountNumber: maskAccountNumber(bankAccount?.bankAccountNumber),
        bankIFSC: bankAccount?.bankIFSC || "N/A",
        bankAccountHolderName: bankAccount?.bankAccountHolderName || "N/A",
        bankName: bankAccount?.bankName || "N/A",
        razorpayPayoutId: w.razorpayPayoutId,
        failureReason: w.failureReason,
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        processedAt: w.processedAt,
      })),
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Error fetching withdrawals:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch withdrawals" },
      { status: 500 }
    );
  }
}

// POST - Create withdrawal request
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;

    if (!doctorId) {
      return NextResponse.json({ error: "doctorId is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const { amount } = body;

    if (!amount || typeof amount !== "number" || isNaN(amount) || !Number.isInteger(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Valid amount is required" },
        { status: 400 }
      );
    }

    // Get doctor's current balance and bank details from BankAccount
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

    const authUser = await getAuthenticatedUser(req);
    if (authUser && doctor.userId !== authUser.id && authUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let bankAccount = doctor.user?.bankAccounts?.[0];

    // If no existing bank account is linked, check if details were provided in payload
    if (!bankAccount && body.bankAccountNumber && body.bankIFSC) {
      bankAccount = await prisma.bankAccount.create({
        data: {
          userId: doctor.user.id,
          bankAccountNumber: body.bankAccountNumber,
          bankIFSC: body.bankIFSC,
          bankAccountHolderName: body.bankAccountHolderName || doctor.user.name || "Doctor",
          bankName: body.bankName || "Bank",
        },
      });
    }

    // Check if bank details are set
    if (!bankAccount || !bankAccount.bankAccountNumber || !bankAccount.bankIFSC) {
      return NextResponse.json(
        { error: "Bank details not set. Please add bank details first." },
        { status: 400 }
      );
    }

    // Convert amount from rupees to paise
    const amountInPaise = Math.round(amount * 100);
    const minimumWithdrawal = 10000; // Minimum ₹100 in paise

    if (amountInPaise < minimumWithdrawal) {
      return NextResponse.json(
        { error: `Minimum withdrawal amount is ₹${minimumWithdrawal / 100}` },
        { status: 400 }
      );
    }

    // Atomic transaction ensuring balance >= amountInPaise
    const withdrawal = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.doctor.updateMany({
        where: {
          id: doctorId,
          balance: { gte: amountInPaise },
        },
        data: {
          balance: { decrement: amountInPaise },
        },
      });

      if (updateResult.count === 0) {
        return null;
      }

      return await tx.withdrawal.create({
        data: {
          doctorId,
          amount: amountInPaise,
          currency: "INR",
          status: "PENDING",
        },
      });
    });

    if (!withdrawal) {
      return NextResponse.json(
        { error: "Insufficient balance" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        message: "Withdrawal request created successfully",
        withdrawal: {
          ...withdrawal,
          amountInRupees: withdrawal.amount / 100,
          bankAccountNumber: maskAccountNumber(bankAccount.bankAccountNumber),
          bankIFSC: bankAccount.bankIFSC,
          bankAccountHolderName: bankAccount.bankAccountHolderName,
          bankName: bankAccount.bankName,
        },
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error("Error creating withdrawal:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create withdrawal request" },
      { status: 500 }
    );
  }
}
