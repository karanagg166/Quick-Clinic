import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { WithdrawalStatus } from "@/generated/prisma";

function maskAccountNumber(accountNumber?: string | null): string {
  if (!accountNumber) return "N/A";
  const trimmed = accountNumber.trim();
  if (trimmed.length <= 4) return trimmed;
  return `********${trimmed.slice(-4)}`;
}

export async function GET(req: NextRequest) {
  try {
    const adminUser = await getAuthenticatedUser(req);
    if (!adminUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (adminUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const doctorId = searchParams.get("doctorId");

    const where: any = {};
    if (status) {
      const upper = status.toUpperCase();
      if (upper === "APPROVED") where.status = "COMPLETED";
      else if (upper === "REJECTED") where.status = "FAILED";
      else if (Object.values(WithdrawalStatus).includes(upper as WithdrawalStatus)) {
        where.status = upper as WithdrawalStatus;
      }
    }
    if (doctorId) {
      where.doctorId = doctorId;
    }

    const withdrawals = await prisma.withdrawal.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: {
        doctor: {
          include: {
            user: {
              include: { bankAccounts: true },
            },
          },
        },
      },
    });

    const formatted = withdrawals.map((w) => {
      const bankAccount = w.doctor?.user?.bankAccounts?.[0];
      return {
        id: w.id,
        doctorId: w.doctorId,
        doctorName: w.doctor?.user?.name || "Doctor",
        doctorEmail: w.doctor?.user?.email || "",
        amount: w.amount,
        amountInRupees: w.amount / 100,
        currency: w.currency,
        status: w.status,
        failureReason: w.failureReason,
        bankAccountNumber: maskAccountNumber(bankAccount?.bankAccountNumber),
        bankIFSC: bankAccount?.bankIFSC || "N/A",
        bankName: bankAccount?.bankName || "N/A",
        createdAt: w.createdAt,
        updatedAt: w.updatedAt,
        processedAt: w.processedAt,
      };
    });

    return NextResponse.json({ withdrawals: formatted }, { status: 200 });
  } catch (error: any) {
    console.error("admin-withdrawals-get-error", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch withdrawals" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const adminUser = await getAuthenticatedUser(req);
    if (!adminUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (adminUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const { withdrawalId, status, failureReason } = body;

    if (!withdrawalId || !status) {
      return NextResponse.json(
        { error: "withdrawalId and status are required" },
        { status: 400 }
      );
    }

    const upperStatus = status.toUpperCase();
    const isApproval = upperStatus === "APPROVED" || upperStatus === "COMPLETED";
    const isRejection = upperStatus === "REJECTED" || upperStatus === "FAILED" || upperStatus === "CANCELLED";

    if (!isApproval && !isRejection) {
      return NextResponse.json(
        { error: "status must be either APPROVED/COMPLETED or REJECTED/FAILED" },
        { status: 400 }
      );
    }

    const withdrawal = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { doctor: true },
    });

    if (!withdrawal) {
      return NextResponse.json({ error: "Withdrawal not found" }, { status: 404 });
    }

    if (withdrawal.status !== "PENDING" && withdrawal.status !== "PROCESSING") {
      return NextResponse.json(
        { error: `Cannot change status of already finalized withdrawal (${withdrawal.status})` },
        { status: 409 }
      );
    }

    if (isApproval) {
      const updated = await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "COMPLETED",
          processedAt: new Date(),
        },
      });

      await logAudit(adminUser.id, `Approved Withdrawal ${withdrawalId}`, {
        withdrawalId,
        doctorId: withdrawal.doctorId,
        amount: withdrawal.amount,
      });

      return NextResponse.json({ success: true, withdrawal: updated }, { status: 200 });
    }

    // Status is REJECTED/FAILED -> refund reserved balance back to doctor
    const updated = await prisma.$transaction(async (tx) => {
      // 1. Credit doctor balance back
      await tx.doctor.update({
        where: { id: withdrawal.doctorId },
        data: {
          balance: { increment: withdrawal.amount },
        },
      });

      // 2. Mark withdrawal FAILED
      return await tx.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: "FAILED",
          failureReason: failureReason || "Rejected by administrator",
          processedAt: new Date(),
        },
      });
    });

    await logAudit(adminUser.id, `Rejected Withdrawal ${withdrawalId}`, {
      withdrawalId,
      doctorId: withdrawal.doctorId,
      amount: withdrawal.amount,
      reason: failureReason,
    });

    return NextResponse.json({ success: true, withdrawal: updated }, { status: 200 });
  } catch (error: any) {
    console.error("admin-withdrawals-patch-error", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process withdrawal" },
      { status: 500 }
    );
  }
}
