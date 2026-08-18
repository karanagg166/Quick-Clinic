import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const adminUser = await getAuthenticatedUser(req);
    if (!adminUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (adminUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const [
      totalUsers,
      totalDoctors,
      totalPatients,
      totalAdmins,
      activeDoctorsCount,
      totalAppointments,
      completedAppointments,
      cancelledAppointments,
      totalPayments,
      totalWithdrawals,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { role: "DOCTOR" } }),
      prisma.user.count({ where: { role: "PATIENT" } }),
      prisma.user.count({ where: { role: "ADMIN" } }),
      prisma.doctor.count({ where: { user: { isActive: true } } }),
      prisma.appointment.count(),
      prisma.appointment.count({ where: { status: "COMPLETED" } }),
      prisma.appointment.count({ where: { status: "CANCELLED" } }),
      prisma.payment.aggregate({
        where: { status: "SUCCESS" },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.withdrawal.aggregate({
        where: { status: "COMPLETED" },
        _sum: { amount: true },
        _count: { id: true },
      }),
    ]);

    const grossTransactionVolumePaise = totalPayments._sum.amount || 0;
    const totalWithdrawnPaise = totalWithdrawals._sum.amount || 0;

    return NextResponse.json(
      {
        users: {
          total: totalUsers,
          doctors: totalDoctors,
          patients: totalPatients,
          admins: totalAdmins,
          activeDoctors: activeDoctorsCount,
        },
        appointments: {
          total: totalAppointments,
          completed: completedAppointments,
          cancelled: cancelledAppointments,
        },
        financials: {
          grossTransactionVolumePaise,
          grossTransactionVolumeRupees: grossTransactionVolumePaise / 100,
          successfulPaymentsCount: totalPayments._count.id || 0,
          totalWithdrawnPaise,
          totalWithdrawnRupees: totalWithdrawnPaise / 100,
          approvedWithdrawalsCount: totalWithdrawals._count.id || 0,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("admin-analytics-get-error", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch analytics" },
      { status: 500 }
    );
  }
}
