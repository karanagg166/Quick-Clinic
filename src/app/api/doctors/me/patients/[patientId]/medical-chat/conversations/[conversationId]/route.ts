import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";

interface RouteParams {
  params: Promise<{
    patientId: string;
    conversationId: string;
  }>;
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
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

    const { patientId, conversationId } = await params;
    if (!patientId || !conversationId) {
      return NextResponse.json(
        { error: "Patient ID and Conversation ID are required" },
        { status: 400 }
      );
    }

    const cleanPatientId = patientId.trim();
    const cleanConversationId = conversationId.trim();

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

    // Appointment re-check on sensitive request
    const accessCheck = await verifyDoctorPatientMedicalAccess(doctor.id, cleanPatientId);
    if (!accessCheck.allowed) {
      await logAudit(
        authUser.id,
        "MEDICAL_CHAT_ACCESS_DENIED",
        {
          patientId: cleanPatientId,
          doctorId: doctor.id,
          conversationId: cleanConversationId,
          reason: accessCheck.reason || "NO_ELIGIBLE_APPOINTMENT",
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        { error: "Access denied. You do not have an active or completed appointment with this patient." },
        { status: 403 }
      );
    }

    const conversation = await prisma.medicalAiConversation.findUnique({
      where: { id: cleanConversationId },
      include: {
        messages: {
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            citations: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Doctor isolation: Doctor A cannot access Doctor B's conversation
    if (conversation.doctorId !== doctor.id) {
      return NextResponse.json(
        { error: "Access denied. You do not own this conversation." },
        { status: 403 }
      );
    }

    // Patient binding: URL patientId must match conversation.patientId
    if (conversation.patientId !== cleanPatientId) {
      return NextResponse.json(
        { error: "Invalid request: conversation is bound to a different patient" },
        { status: 400 }
      );
    }

    // Safe access logging
    await logAccess(
      authUser.id,
      cleanPatientId,
      "MEDICAL_CHAT_VIEWED",
      "MEDICAL_RECORD"
    );

    return NextResponse.json(
      {
        conversation: {
          id: conversation.id,
          doctorId: conversation.doctorId,
          patientId: conversation.patientId,
          title: conversation.title,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
        },
        messages: conversation.messages,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Get medical chat conversation error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to retrieve conversation" },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest, { params }: RouteParams) {
  try {
    const authUser = await getAuthenticatedUser(req, { verifyDb: true });
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

    const { patientId, conversationId } = await params;
    if (!patientId || !conversationId) {
      return NextResponse.json(
        { error: "Patient ID and Conversation ID are required" },
        { status: 400 }
      );
    }

    const cleanPatientId = patientId.trim();
    const cleanConversationId = conversationId.trim();

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

    const accessCheck = await verifyDoctorPatientMedicalAccess(doctor.id, cleanPatientId);
    if (!accessCheck.allowed) {
      await logAudit(
        authUser.id,
        "MEDICAL_CHAT_ACCESS_DENIED",
        {
          patientId: cleanPatientId,
          doctorId: doctor.id,
          conversationId: cleanConversationId,
          reason: accessCheck.reason || "NO_ELIGIBLE_APPOINTMENT",
        },
        "MEDICAL_RECORD"
      );

      return NextResponse.json(
        { error: "Access denied. You do not have an active or completed appointment with this patient." },
        { status: 403 }
      );
    }

    const conversation = await prisma.medicalAiConversation.findUnique({
      where: { id: cleanConversationId },
      select: { id: true, doctorId: true, patientId: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    if (conversation.doctorId !== doctor.id) {
      return NextResponse.json(
        { error: "Access denied. You do not own this conversation." },
        { status: 403 }
      );
    }

    if (conversation.patientId !== cleanPatientId) {
      return NextResponse.json(
        { error: "Invalid request: conversation is bound to a different patient" },
        { status: 400 }
      );
    }

    await prisma.medicalAiConversation.delete({
      where: { id: cleanConversationId },
    });

    await logAudit(
      authUser.id,
      "MEDICAL_CHAT_CONVERSATION_DELETED",
      {
        patientId: cleanPatientId,
        conversationId: cleanConversationId,
      },
      "MEDICAL_RECORD"
    );

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("Delete medical chat conversation error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to delete conversation" },
      { status: 500 }
    );
  }
}
