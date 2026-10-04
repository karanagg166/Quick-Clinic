import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";

interface RouteParams {
  params: Promise<{
    patientId: string;
  }>;
}

const createConversationSchema = z.object({
  title: z.string().trim().max(120, "Title cannot exceed 120 characters").optional().nullable(),
});

export async function POST(req: NextRequest, { params }: RouteParams) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (authUser.role !== "DOCTOR") {
      return NextResponse.json(
        { error: "Access denied. Only doctors can access this endpoint." },
        { status: 403 }
      );
    }

    const { patientId } = await params;
    if (!patientId || typeof patientId !== "string" || !patientId.trim()) {
      return NextResponse.json(
        { error: "Patient ID is required" },
        { status: 400 }
      );
    }

    const cleanPatientId = patientId.trim();

    const doctor = await prisma.doctor.findUnique({
      where: { userId: authUser.id },
      select: { id: true },
    });

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor profile not found" },
        { status: 404 }
      );
    }

    // Authorization check: Only CONFIRMED or COMPLETED appointments
    const accessCheck = await verifyDoctorPatientMedicalAccess(doctor.id, cleanPatientId);
    if (!accessCheck.allowed) {
      await logAudit(
        authUser.id,
        "MEDICAL_CHAT_ACCESS_DENIED",
        {
          patientId: cleanPatientId,
          doctorId: doctor.id,
          reason: accessCheck.reason || "NO_ELIGIBLE_APPOINTMENT",
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        { error: "Access denied. You do not have an active or completed appointment with this patient." },
        { status: 403 }
      );
    }

    const bodyJson = await req.json().catch(() => ({}));
    const parsed = createConversationSchema.safeParse(bodyJson);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || "Invalid conversation creation request";
      return NextResponse.json({ error: issue }, { status: 400 });
    }

    const title = parsed.data.title || null;

    const conversation = await prisma.medicalAiConversation.create({
      data: {
        doctorId: doctor.id,
        patientId: cleanPatientId,
        title,
      },
      select: {
        id: true,
        doctorId: true,
        patientId: true,
        title: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Strictly PHI-safe audit logging: log patientId and conversationId; never raw medical content
    await logAudit(
      authUser.id,
      "MEDICAL_CHAT_CONVERSATION_CREATED",
      {
        patientId: cleanPatientId,
        conversationId: conversation.id,
      },
      "MEDICAL_RECORD"
    );

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error: any) {
    console.error("Create medical chat conversation error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create conversation" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    if (authUser.role !== "DOCTOR") {
      return NextResponse.json(
        { error: "Access denied. Only doctors can access this endpoint." },
        { status: 403 }
      );
    }

    const { patientId } = await params;
    if (!patientId || typeof patientId !== "string" || !patientId.trim()) {
      return NextResponse.json(
        { error: "Patient ID is required" },
        { status: 400 }
      );
    }

    const cleanPatientId = patientId.trim();

    const doctor = await prisma.doctor.findUnique({
      where: { userId: authUser.id },
      select: { id: true },
    });

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor profile not found" },
        { status: 404 }
      );
    }

    // Re-check appointment access
    const accessCheck = await verifyDoctorPatientMedicalAccess(doctor.id, cleanPatientId);
    if (!accessCheck.allowed) {
      await logAudit(
        authUser.id,
        "MEDICAL_CHAT_ACCESS_DENIED",
        {
          patientId: cleanPatientId,
          doctorId: doctor.id,
          reason: accessCheck.reason || "NO_ELIGIBLE_APPOINTMENT",
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        { error: "Access denied. You do not have an active or completed appointment with this patient." },
        { status: 403 }
      );
    }

    // Fetch conversations bound strictly to authenticated doctor and requested patient
    const conversations = await prisma.medicalAiConversation.findMany({
      where: {
        doctorId: doctor.id,
        patientId: cleanPatientId,
      },
      orderBy: {
        updatedAt: "desc",
      },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: { messages: true },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            role: true,
            createdAt: true,
            content: true,
          },
        },
      },
    });

    const formatted = conversations.map((conv) => {
      const lastMsg = conv.messages[0];
      return {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv._count.messages,
        lastMessagePreview: lastMsg
          ? {
              role: lastMsg.role,
              preview: lastMsg.content.slice(0, 80),
              createdAt: lastMsg.createdAt,
            }
          : null,
      };
    });

    return NextResponse.json({ conversations: formatted }, { status: 200 });
  } catch (error: any) {
    console.error("List medical chat conversations error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to list conversations" },
      { status: 500 }
    );
  }
}
