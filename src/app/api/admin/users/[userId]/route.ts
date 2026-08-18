import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAudit } from "@/lib/logger";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUser = await getAuthenticatedUser(req);
    if (!adminUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (adminUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await params;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        doctor: {
          include: {
            doctorQualifications: true,
            schedule: true,
          },
        },
        patient: true,
        admin: {
          include: {
            manager: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
            subAdmins: {
              include: { user: { select: { id: true, name: true, email: true } } },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user }, { status: 200 });
  } catch (error: any) {
    console.error("admin-user-get-error", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch user" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUser = await getAuthenticatedUser(req);
    if (!adminUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (adminUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await params;
    const body = await req.json().catch(() => ({}));
    const { isActive, role } = body;

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      include: { doctor: true, patient: true, admin: true },
    });

    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Hierarchy Guard: Sub-admin cannot deactivate or demote super-admin or fellow sub-admins
    const requestingAdmin = await prisma.admin.findUnique({ where: { userId: adminUser.id } });
    if (targetUser.role === "ADMIN" && targetUser.id !== adminUser.id) {
      if (requestingAdmin?.managerId !== null) {
        return NextResponse.json(
          { error: "Forbidden: Only Super Admin can modify other Admin accounts" },
          { status: 403 }
        );
      }
    }

    const updateData: any = {};
    if (typeof isActive === "boolean") {
      updateData.isActive = isActive;
    }
    if (role && ["PATIENT", "DOCTOR", "ADMIN"].includes(role)) {
      updateData.role = role;
    }

    // Cascade action if user is deactivated
    if (isActive === false && targetUser.isActive === true) {
      if (targetUser.doctor) {
        const doctorId = targetUser.doctor.id;
        // Mark upcoming slots UNAVAILABLE and cancel active appointments
        await prisma.$transaction([
          prisma.appointment.updateMany({
            where: {
              doctorId,
              status: { in: ["PENDING", "CONFIRMED"] },
            },
            data: { status: "CANCELLED" },
          }),
          prisma.slot.updateMany({
            where: {
              doctorId,
              status: { in: ["AVAILABLE", "HELD"] },
            },
            data: { status: "UNAVAILABLE" },
          }),
        ]);
      } else if (targetUser.patient) {
        const patientId = targetUser.patient.id;
        const activeAppts = await prisma.appointment.findMany({
          where: {
            patientId,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
          select: { id: true, slotId: true },
        });

        await prisma.$transaction([
          prisma.appointment.updateMany({
            where: {
              patientId,
              status: { in: ["PENDING", "CONFIRMED"] },
            },
            data: { status: "CANCELLED" },
          }),
          prisma.slot.updateMany({
            where: {
              id: { in: activeAppts.map((a) => a.slotId) },
            },
            data: { status: "AVAILABLE", heldByPatientId: null, holdToken: null },
          }),
        ]);
      }
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isActive: true,
        updatedAt: true,
      },
    });

    await logAudit(adminUser.id, `Admin Updated User ${userId}`, {
      targetUserId: userId,
      changes: updateData,
    });

    return NextResponse.json({ user: updated }, { status: 200 });
  } catch (error: any) {
    console.error("admin-user-patch-error", error);
    return NextResponse.json(
      { error: error?.message || "Failed to update user" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const adminUser = await getAuthenticatedUser(req);
    if (!adminUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (adminUser.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { userId } = await params;
    const targetUser = await prisma.user.findUnique({ where: { id: userId } });
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Only Super Admin can delete users
    const requestingAdmin = await prisma.admin.findUnique({ where: { userId: adminUser.id } });
    if (requestingAdmin?.managerId !== null) {
      return NextResponse.json(
        { error: "Forbidden: Super Admin privilege required to delete users" },
        { status: 403 }
      );
    }

    await prisma.user.delete({ where: { id: userId } });
    await logAudit(adminUser.id, `Admin Deleted User ${userId}`, { targetUserId: userId });

    return NextResponse.json({ success: true, message: "User deleted successfully" }, { status: 200 });
  } catch (error: any) {
    console.error("admin-user-delete-error", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete user" },
      { status: 500 }
    );
  }
}
