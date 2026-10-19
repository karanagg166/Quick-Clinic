import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { persistChatMessage } from "@/lib/chat-service";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ relationId: string }> }
) {
    try {
        const authUser = await getAuthenticatedUser(req, { verifyDb: true });
        if (!authUser) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { relationId: doctorPatientRelationId } = await params;

        if (!doctorPatientRelationId) {
            return NextResponse.json({ error: "Missing relationId" }, { status: 400 });
        }

        // Get pagination parameters from query string
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get("page") || "1", 10);
        const limit = parseInt(searchParams.get("limit") || "50", 10);
        const orderParam = searchParams.get("order")?.toLowerCase();

        // Validate pagination parameters
        if (isNaN(page) || isNaN(limit) || page < 1 || limit < 1) {
            return NextResponse.json(
                { error: "page and limit must be positive integers" },
                { status: 400 }
            );
        }

        if (limit > 100) {
            return NextResponse.json(
                { error: "limit cannot exceed 100" },
                { status: 400 }
            );
        }

        const relation = await prisma.doctorPatientRelation.findUnique({
            where: {
                id: doctorPatientRelationId,
            },
        });

        if (!relation) {
            return NextResponse.json({ error: "Relation not found" }, { status: 404 });
        }

        if (
            authUser.role !== "ADMIN" &&
            !((authUser.role === "DOCTOR" && relation.doctorsUserId === authUser.id) ||
              (authUser.role === "PATIENT" && relation.patientsUserId === authUser.id))
        ) {
            return NextResponse.json({ error: "Forbidden" }, { status: 403 });
        }

        // Calculate skip for pagination
        const skip = (page - 1) * limit;

        const totalMessages = await prisma.chatMessages.count({
            where: { doctorPatientRelationId },
        });

        // If explicitly requested chronological asc without recent window, order asc
        // Otherwise (default for chat UIs), fetch latest messages desc and reverse to chronological
        let chats: any[];
        if (orderParam === "asc") {
            chats = await prisma.chatMessages.findMany({
                where: { doctorPatientRelationId },
                include: {
                    sender: {
                        select: { id: true, name: true, role: true },
                    },
                },
                orderBy: { createdAt: "asc" },
                skip,
                take: limit,
            });
        } else {
            const rawDesc = await prisma.chatMessages.findMany({
                where: { doctorPatientRelationId },
                include: {
                    sender: {
                        select: { id: true, name: true, role: true },
                    },
                },
                orderBy: { createdAt: "desc" },
                skip,
                take: limit,
            });
            chats = rawDesc.reverse();
        }

        // Calculate total pages
        const totalPages = Math.ceil(totalMessages / limit) || 1;

        return NextResponse.json(
            {
                chats,
                pagination: {
                    currentPage: page,
                    pageSize: limit,
                    totalMessages,
                    totalPages,
                    hasNextPage: page < totalPages,
                    hasPreviousPage: page > 1,
                },
            },
            { status: 200 }
        );
    } catch (error) {
        console.error("Error fetching chats:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ relationId: string }> }
) {
    try {
        const authUser = await getAuthenticatedUser(req, { verifyDb: true });
        if (!authUser) {
          return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const { relationId: doctorPatientRelationId } = await params;

        if (!doctorPatientRelationId) {
            return NextResponse.json({ error: "Missing relationId" }, { status: 400 });
        }

        const body = await req.json().catch(() => ({}));
        const rawText = body.text !== undefined ? body.text : body.message;
        const clientMessageId =
            body.clientMessageId !== undefined
                ? body.clientMessageId
                : body.idempotencyKey !== undefined
                ? body.idempotencyKey
                : body.id;

        const result = await persistChatMessage({
            doctorPatientRelationId,
            senderId: authUser.id,
            text: rawText,
            clientMessageId,
            isAdmin: authUser.role === "ADMIN",
        });

        if (!result.success) {
            return NextResponse.json({ error: result.error }, { status: result.statusCode });
        }

        return NextResponse.json({ chat: result.chat }, { status: result.statusCode });
    } catch (error) {
        console.error("Error posting chat message:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
