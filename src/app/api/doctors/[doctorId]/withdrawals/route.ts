import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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

    const withdrawals = await prisma.withdrawal.findMany({
      where: { doctorId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        amount: true,
        currency: true,
        status: true,
        bankAccountNumber: true,
        bankIFSC: true,
        bankAccountHolderName: true,
        bankName: true,
        razorpayPayoutId: true,
        failureReason: true,
        createdAt: true,
        updatedAt: true,
        processedAt: true,
      },
    });

    return NextResponse.json(
      withdrawals.map((w: {
        id: string;
        amount: number;
        currency: string;
        status: string;
        bankAccountNumber: string;
        bankIFSC: string;
        bankAccountHolderName: string;
        bankName: string;
        razorpayPayoutId: string | null;
        failureReason: string | null;
        createdAt: Date;
        updatedAt: Date;
        processedAt: Date | null;
      }) => ({
        ...w,
        amountInRupees: w.amount / 100, // Convert from paise to rupees
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

    const body = await req.json();
    const { amount } = body;

    if (!amount || isNaN(amount) || amount <= 0) {
      return NextResponse.json(
        { error: "Valid amount is required" },
        { status: 400 }
      );
    }

    // Get doctor's current balance and bank details
    const doctor = await prisma.doctor.findUnique({
      where: { id: doctorId },
      select: {
        balance: true,
        bankAccountNumber: true,
        bankIFSC: true,
        bankAccountHolderName: true,
        bankName: true,
      },
    });

    if (!doctor) {
      return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
    }

    // Check if bank details are set
    if (!doctor.bankAccountNumber || !doctor.bankIFSC || !doctor.bankAccountHolderName || !doctor.bankName) {
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

    // Check if doctor has sufficient balance
    if (doctor.balance < amountInPaise) {
      return NextResponse.json(
        { error: "Insufficient balance" },
        { status: 400 }
      );
    }

    // Create withdrawal request
    const withdrawal = await prisma.withdrawal.create({
      data: {
        doctorId,
        amount: amountInPaise,
        currency: "INR",
        status: "PENDING",
        bankAccountNumber: doctor.bankAccountNumber,
        bankIFSC: doctor.bankIFSC,
        bankAccountHolderName: doctor.bankAccountHolderName,
        bankName: doctor.bankName,
      },
    });

    // Deduct amount from doctor's balance immediately
    await prisma.doctor.update({
      where: { id: doctorId },
      data: {
        balance: {
          decrement: amountInPaise,
        },
      },
    });

    // TODO: Integrate with Razorpay Payouts API to process the withdrawal
    // For now, we'll mark it as PROCESSING and handle it manually or via cron job
    // You can implement Razorpay Payouts API integration here

    return NextResponse.json(
      {
        message: "Withdrawal request created successfully",
        withdrawal: {
          ...withdrawal,
          amountInRupees: withdrawal.amount / 100,
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

