import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ relationId: string }> }
) {
    try {
        const { relationId: doctorPatientRelationId } = await params;

        if (!doctorPatientRelationId) {
            return NextResponse.json({ error: "Missing relationId" }, { status: 400 });
        }

        // Get pagination parameters from query string
        const { searchParams } = new URL(req.url);
        const page = parseInt(searchParams.get("page") || "1", 10);
        const limit = parseInt(searchParams.get("limit") || "20", 10);

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

        // Calculate skip for pagination
        const skip = (page - 1) * limit;

        // Get total count of messages
        const totalMessages = await prisma.chatMessages.count({
            where: {
                doctorPatientRelationId,
            },
        });

        // Fetch paginated messages
        const chats = await prisma.chatMessages.findMany({
            where: {
                doctorPatientRelationId,
            },
            orderBy: {
                createdAt: "asc",
            },
            skip,
            take: limit,
        });

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
        const { relationId: doctorPatientRelationId } = await params;

        if (!doctorPatientRelationId) {
            return NextResponse.json({ error: "Missing relationId" }, { status: 400 });
        }

        const body = await req.json();
        const text = (body.text || body.message || "").trim();
        const senderId = body.senderId;

        if (!text || !senderId) {
            return NextResponse.json(
                { error: "message and senderId are required" },
                { status: 400 }
            );
        }

        // Verify relation exists
        const relation = await prisma.doctorPatientRelation.findUnique({
            where: { id: doctorPatientRelationId },
        });

        if (!relation) {
            return NextResponse.json({ error: "Relation not found" }, { status: 404 });
        }

        const newChat = await prisma.chatMessages.create({
            data: {
                doctorPatientRelationId,
                text,
                senderId,
            },
        });

        return NextResponse.json({ chat: newChat }, { status: 201 });
    } catch (error) {
        console.error("Error posting chat message:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}
