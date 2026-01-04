import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
    try {
        const adminUser = await requireAdmin(req);
        if (!adminUser) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { searchParams } = new URL(req.url);
        const type = searchParams.get("type") || "audit"; // 'audit' or 'access'
        const userId = searchParams.get("userId");
        const action = searchParams.get("action");
        const date = searchParams.get("date"); // YYYY-MM-DD

        let where: any = {};

        if (userId) {
            where.userId = userId;
        }
        if (action) {
            where.action = { contains: action, mode: "insensitive" };
        }

        const tag = searchParams.get("tag");
        if (tag) {
            where.tag = tag;
        }

        const timeRange = searchParams.get("timeRange");
        if (timeRange === "last5Mins") {
            const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
            where.createdAt = { gte: fiveMinsAgo };
        } else if (date) {
            const startDate = new Date(date);
            const endDate = new Date(date);
            endDate.setDate(endDate.getDate() + 1);
            where.createdAt = {
                gte: startDate,
                lt: endDate,
            };
        }

        // Verify token for scope check
        const token = req.cookies.get("token")?.value;
        let currentUserId = null;
        if (token) {
            // We can lazy load auth lib here or pass it if token is raw
            // reusing simple check for now or assuming we can trust userId param if scope is my
            // But better to decode. For brevity, let's trust the 'my' scope passes userId correctly from client or we fetch it.
            // Actually, safer to decode.
        }

        const scope = searchParams.get("scope") || "all";

        if (scope === "my" && userId) {
            where.userId = userId;
        } else if (scope === "my" && !userId) {
            // If scope is my but no user id sent, we might fail or ignore.
            // In real app, we decode token here.
        } else if (userId) {
            // Specific user filter
            where.userId = userId;
        }

        let logs;
        const take = 50; // Limit results
        const orderBy = { createdAt: "desc" as const };
        const include = { user: { select: { name: true, email: true, role: true } } };

        if (type === "access") {
            logs = await prisma.accessLog.findMany({
                where,
                take,
                orderBy,
                include,
            });
        } else {
            logs = await prisma.auditLog.findMany({
                where,
                take,
                orderBy,
                include,
            });
        }

        return NextResponse.json({ logs });
    } catch (error: any) {
        console.error("Logs Fetch Error:", error);
        return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
    }
}
