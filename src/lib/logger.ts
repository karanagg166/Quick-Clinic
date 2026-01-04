import { prisma } from "@/lib/prisma";

export async function logAudit(userId: string | null | undefined, action: string, metadata?: any, tag: string = "SYSTEM") {
    try {
        await prisma.auditLog.create({
            data: {
                userId: userId ?? null,
                action,
                metadata: metadata ? JSON.stringify(metadata) : null,
                tag,
            },
        });
    } catch (error) {
        console.error("Failed to create audit log:", error);
    }
}

export async function logAccess(userId: string | null | undefined, targetId: string | null | undefined, action: string, tag: string = "SYSTEM") {
    try {
        await prisma.accessLog.create({
            data: {
                userId: userId ?? null,
                targetId: targetId ?? null,
                action,
                tag,
            },
        });
    } catch (error) {
        console.error("Failed to create access log:", error);
    }
}
