import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@/lib/logger";
import { requireAdmin } from "@/lib/auth";

const SUPER_ADMIN_CODE = process.env.SUPER_ADMIN_CODE || "QUICK_CLINIC_SUPER_ADMIN";

export async function POST(req: NextRequest) {
    try {
        const adminUser = await requireAdmin(req);
        if (!adminUser) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { userId, managerEmail, secretCode, name, phoneNo, gender, age } = await req.json();

        // Ensure the logged-in user matches the userId being onboarded (optional but good security)
        if (adminUser.id !== userId) {
            return NextResponse.json({ error: "Forbidden: You can only onboard yourself" }, { status: 403 });
        }

        if (!userId) {
            return NextResponse.json({ error: "User ID is required" }, { status: 400 });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { admin: true },
        });

        if (!user) {
            return NextResponse.json({ error: "User not found" }, { status: 404 });
        }

        if (user.role !== "ADMIN") {
            return NextResponse.json({ error: "User is not an admin" }, { status: 403 });
        }

        let isActive = false;
        let managerId: string | null = null;
        let logAction = "Admin Onboarding Request";

        // Scenario 1: Super Admin Code
        if (secretCode) {
            if (secretCode === SUPER_ADMIN_CODE) {
                isActive = true;
                logAction = "Admin Auto-Approved (Super Code)";
            } else {
                return NextResponse.json({ error: "Invalid Super Admin Code" }, { status: 400 });
            }
        }
        // Scenario 2: Manager Email
        else if (managerEmail) {
            const managerUser = await prisma.user.findUnique({
                where: { email: managerEmail },
                include: { admin: true },
            });

            if (!managerUser || !managerUser.admin) {
                return NextResponse.json({ error: "Manager not found or not an admin" }, { status: 404 });
            }

            // Check if manager is active? (Optional logic, let's assume yes)
            managerId = managerUser.admin.id;
            logAction = "Admin Linked to Manager";
        }
        else {
            return NextResponse.json({ error: "Either Manager Email or Secret Code is required" }, { status: 400 });
        }

        // Update User Profile Details
        await prisma.user.update({
            where: { id: userId },
            data: {
                name,
                phoneNo,
                gender,
                age: age ? Number(age) : undefined,
                isActive: isActive, // Set active status based on flow
            },
        });

        // Upsert Admin Record
        const admin = await prisma.admin.upsert({
            where: { userId },
            create: {
                userId,
                managerId,
            },
            update: {
                managerId,
            },
        });

        // Log the event
        await logAudit(userId, logAction, { managerId, isActive });

        return NextResponse.json({ success: true, isActive, managerId }, { status: 200 });

    } catch (error: any) {
        console.error("Onboarding Error:", error);
        return NextResponse.json(
            { error: error.message || "Internal Server Error" },
            { status: 500 }
        );
    }
}
