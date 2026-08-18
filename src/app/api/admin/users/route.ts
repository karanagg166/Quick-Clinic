import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser, requireAdmin } from "@/lib/auth";
import { Role } from "@/generated/prisma";

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const role = searchParams.get("role");
    const search = searchParams.get("search")?.trim();
    const page = Math.max(parseInt(searchParams.get("page") || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") || "20", 10), 1), 100);
    const skip = (page - 1) * limit;

    const where: any = {};

    if (role && Object.values(Role).includes(role.toUpperCase() as Role)) {
      where.role = role.toUpperCase() as Role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { phoneNo: { contains: search, mode: "insensitive" } },
      ];
    }

    const [totalUsers, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNo: true,
          role: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          doctor: {
            select: {
              id: true,
              specialty: true,
              fees: true,
              experience: true,
              balance: true,
            },
          },
          patient: {
            select: {
              id: true,
              allergies: true,
              medicalHistory: true,
            },
          },
          admin: {
            select: {
              id: true,
              managerId: true,
            },
          },
        },
      }),
    ]);

    const totalPages = Math.ceil(totalUsers / limit);

    return NextResponse.json(
      {
        users,
        pagination: {
          page,
          limit,
          totalUsers,
          totalPages,
          hasMore: page < totalPages,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("admin-users-get-error", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch users" },
      { status: 500 }
    );
  }
}
