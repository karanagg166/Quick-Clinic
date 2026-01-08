import { prisma } from "@/lib/prisma";

export async function logAudit(userId: string | null | undefined, action: string, metadata?: any, tag: string = "SYSTEM") {
    try {
        const createData: any = {
            action,
            metadata: metadata ? JSON.stringify(metadata) : null,
            tag,
        };

        if (userId) {
            createData.user = { connect: { id: userId } };
        }

        await prisma.auditLog.create({
            data: createData,
        });
    } catch (error) {
        console.error("Failed to create audit log:", error);
    }
}

export async function logAccess(userId: string | null | undefined, targetId: string | null | undefined, action: string, tag: string = "SYSTEM") {
    try {
        const createData: any = {
            targetId: targetId ?? null,
            action,
            tag,
        };

        if (userId) {
            createData.user = { connect: { id: userId } };
        }

        await prisma.accessLog.create({
            data: createData,
        });
    } catch (error) {
        console.error("Failed to create access log:", error);
    }
}
