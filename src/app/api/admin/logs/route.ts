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
        const tag = searchParams.get("tag");
        const role = searchParams.get("role");
        const scope = searchParams.get("scope") || "all";
        const cursor = searchParams.get("cursor") || undefined;
        const rawLimit = parseInt(searchParams.get("limit") || "50", 10);
        const limit = Math.min(Math.max(isNaN(rawLimit) ? 50 : rawLimit, 1), 100);

        let where: any = {};

        // Scope resolution: "my" strictly uses the authenticated admin's ID
        if (scope === "my") {
            where.userId = adminUser.id;
        } else if (userId) {
            where.userId = userId;
        }

        if (action) {
            where.action = { contains: action, mode: "insensitive" };
        }

        if (tag) {
            where.tag = tag;
        }

        if (role) {
            where.user = { role };
        }

        // Date and time range filters
        const timeRange = searchParams.get("timeRange");
        const startDateParam = searchParams.get("startDate");
        const endDateParam = searchParams.get("endDate");
        const dateParam = searchParams.get("date"); // Single day YYYY-MM-DD

        if (timeRange === "last5Mins") {
            const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
            where.createdAt = { gte: fiveMinsAgo };
        } else if (startDateParam || endDateParam) {
            const dateFilter: any = {};
            if (startDateParam) {
                const s = new Date(startDateParam);
                if (!isNaN(s.getTime())) dateFilter.gte = s;
            }
            if (endDateParam) {
                const e = new Date(endDateParam);
                if (!isNaN(e.getTime())) dateFilter.lte = e;
            }
            if (Object.keys(dateFilter).length > 0) {
                where.createdAt = dateFilter;
            }
        } else if (dateParam) {
            const startDate = new Date(dateParam);
            if (!isNaN(startDate.getTime())) {
                const endDate = new Date(startDate);
                endDate.setDate(endDate.getDate() + 1);
                where.createdAt = {
                    gte: startDate,
                    lt: endDate,
                };
            }
        }

        const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];
        const include = { user: { select: { id: true, name: true, email: true, role: true } } };

        let logs: any[] = [];
        const take = limit + 1; // Fetch 1 extra to determine nextCursor

        if (type === "access") {
            logs = await prisma.accessLog.findMany({
                where,
                take,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                orderBy,
                include,
            });
        } else {
            logs = await prisma.auditLog.findMany({
                where,
                take,
                ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
                orderBy,
                include,
            });
        }

        const hasMore = logs.length > limit;
        const returnedLogs = hasMore ? logs.slice(0, limit) : logs;
        const nextCursor = hasMore && returnedLogs.length > 0 ? returnedLogs[returnedLogs.length - 1].id : null;

        return NextResponse.json({
            logs: returnedLogs,
            pagination: {
                limit,
                nextCursor,
                hasMore,
            },
        }, { status: 200 });
    } catch (error: any) {
        console.error("Logs Fetch Error:", error);
        return NextResponse.json({ error: "Failed to fetch logs" }, { status: 500 });
    }
}
