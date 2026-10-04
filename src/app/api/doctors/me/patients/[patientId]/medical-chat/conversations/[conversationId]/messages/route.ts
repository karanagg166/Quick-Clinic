import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";
import {
  generatePatientMedicalChat,
  MedicalChatMessage,
} from "@/lib/search-sphere-client";

interface RouteParams {
  params: Promise<{
    patientId: string;
    conversationId: string;
  }>;
}

const messageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, "Message cannot be empty")
    .max(2000, "Message cannot exceed 2000 characters"),
  limit: z.coerce.number().int().min(1).max(20).default(8).optional(),
});

function generateDeterministicTitle(text: string): string {
  const clean = text.replace(/[^\w\s]/gi, "").trim();
  const words = clean.split(/\s+/).slice(0, 5).join(" ");
  if (!words) return "Medical Consultation";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  let authUserId: string | null = null;
  let cleanPatientId: string | null = null;
  let cleanConversationId: string | null = null;
  let doctorId: string | null = null;

  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }
    authUserId = authUser.id;

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

    cleanPatientId = patientId.trim();
    cleanConversationId = conversationId.trim();

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
    doctorId = doctor.id;

    // Appointment re-check on every sensitive message request
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
      select: { id: true, doctorId: true, patientId: true, title: true },
    });

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404 }
      );
    }

    // Doctor isolation
    if (conversation.doctorId !== doctor.id) {
      return NextResponse.json(
        { error: "Access denied. You do not own this conversation." },
        { status: 403 }
      );
    }

    // Patient binding
    if (conversation.patientId !== cleanPatientId) {
      return NextResponse.json(
        { error: "Invalid request: conversation is bound to a different patient" },
        { status: 400 }
      );
    }

    const bodyJson = await req.json().catch(() => null);
    const parsed = messageSchema.safeParse(bodyJson);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]?.message || "Invalid message request";
      return NextResponse.json({ error: issue }, { status: 400 });
    }

    const { message: userText, limit = 8 } = parsed.data;

    // 1. Persist USER message first
    const userMessage = await prisma.medicalAiMessage.create({
      data: {
        conversationId: cleanConversationId,
        role: "USER",
        content: userText,
        status: "COMPLETE",
      },
    });

    // Auto-title conversation if currently untitled
    if (!conversation.title) {
      const generatedTitle = generateDeterministicTitle(userText);
      await prisma.medicalAiConversation.update({
        where: { id: cleanConversationId },
        data: { title: generatedTitle },
      });
    }

    // 2. Build limited conversation history (bounded to last 6-10 messages before current)
    const recentMessages = await prisma.medicalAiMessage.findMany({
      where: {
        conversationId: cleanConversationId,
        id: { not: userMessage.id },
        status: "COMPLETE",
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { role: true, content: true },
    });

    // Chronological order for history
    const historyPayload: MedicalChatMessage[] = recentMessages.reverse().map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));

    // 3. Call Search Sphere internal multi-turn chat endpoint
    let chatResponse;
    try {
      chatResponse = await generatePatientMedicalChat({
        patientId: cleanPatientId,
        message: userText,
        history: historyPayload,
        limit,
      });
    } catch (err: any) {
      console.error("Search Sphere chat generation error:", err);
      return NextResponse.json(
        { error: err?.message || "Failed to generate grounded answer from Search Sphere" },
        { status: 500 }
      );
    }

    // 4. Citation authorization validation (Defense-in-depth against cross-patient contamination)
    if (chatResponse.citations && chatResponse.citations.length > 0) {
      const citedDocIds = Array.from(
        new Set(chatResponse.citations.map((c) => c.documentId).filter(Boolean))
      );

      const matchingDocs = await prisma.medicalDocument.findMany({
        where: {
          id: { in: citedDocIds as string[] },
          patientId: cleanPatientId,
        },
        select: { id: true },
      });

      const matchingDocIdSet = new Set(matchingDocs.map((d) => d.id));
      const hasInvalidCitation = citedDocIds.some((id) => !matchingDocIdSet.has(id));

      if (hasInvalidCitation) {
        console.error(
          `[SECURITY ANOMALY] Search Sphere returned citations for documents not belonging to patient ${cleanPatientId}`
        );
        await logAudit(
          authUser.id,
          "MEDICAL_CHAT_SECURITY_ANOMALY",
          {
            patientId: cleanPatientId,
            doctorId: doctor.id,
            conversationId: cleanConversationId,
            reason: "CROSS_PATIENT_CITATION_DETECTED",
          },
          "MEDICAL_RECORD"
        );

        return NextResponse.json(
          { error: "Security validation failed: invalid citation references detected" },
          { status: 500 }
        );
      }
    }

    // 5. Persist ASSISTANT message only after successful validation
    const assistantMessage = await prisma.medicalAiMessage.create({
      data: {
        conversationId: cleanConversationId,
        role: "ASSISTANT",
        content: chatResponse.answer,
        citations: chatResponse.citations as any,
        status: "COMPLETE",
      },
    });

    await prisma.medicalAiConversation.update({
      where: { id: cleanConversationId },
      data: { updatedAt: new Date() },
    });

    // Strictly PHI-safe logging: log patientId, conversationId, citationCount; never raw message or answer text
    await logAccess(
      authUser.id,
      cleanPatientId,
      "MEDICAL_CHAT_MESSAGE_SENT",
      "MEDICAL_RECORD"
    );

    await logAudit(
      authUser.id,
      "MEDICAL_CHAT_RESPONSE_GENERATED",
      {
        patientId: cleanPatientId,
        conversationId: cleanConversationId,
        citationCount: chatResponse.citations.length,
      },
      "MEDICAL_RECORD"
    );

    if (chatResponse.answerMode === "STRUCTURED") {
      await logAudit(
        authUser.id,
        "MEDICAL_STRUCTURED_QUERY",
        {
          patientId: cleanPatientId,
          conversationId: cleanConversationId,
          citationCount: chatResponse.citations.length,
        },
        "MEDICAL_RECORD"
      );
    } else if (chatResponse.answerMode === "HYBRID") {
      await logAudit(
        authUser.id,
        "MEDICAL_HYBRID_QUERY",
        {
          patientId: cleanPatientId,
          conversationId: cleanConversationId,
          citationCount: chatResponse.citations.length,
        },
        "MEDICAL_RECORD"
      );
    }

    return NextResponse.json(
      {
        message: assistantMessage,
        citations: chatResponse.citations,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("Medical chat message endpoint error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process chat message" },
      { status: 500 }
    );
  }
}
