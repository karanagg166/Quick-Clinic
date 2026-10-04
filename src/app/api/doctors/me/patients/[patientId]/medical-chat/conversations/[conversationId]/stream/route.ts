import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAuthenticatedUser } from "@/lib/auth";
import { logAccess, logAudit } from "@/lib/logger";
import { verifyDoctorPatientMedicalAccess } from "@/lib/medical-record-access";
import {
  openPatientMedicalChatStream,
  MedicalChatMessage,
  MedicalRagCitation,
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

    // Appointment re-check on every sensitive streaming request
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

    // 2. Build bounded conversation history (take up to 8 messages before this one)
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

    const historyPayload: MedicalChatMessage[] = recentMessages.reverse().map((m) => ({
      role: m.role === "USER" ? "user" : "assistant",
      content: m.content,
    }));

    // 3. Open connection to Search Sphere stream
    const ssStreamResponse = await openPatientMedicalChatStream({
      patientId: cleanPatientId,
      message: userText,
      history: historyPayload,
      limit,
    });

    if (!ssStreamResponse.body) {
      return NextResponse.json(
        { error: "Search Sphere stream body is empty" },
        { status: 502 }
      );
    }

    const targetPatientId = cleanPatientId;
    const targetConversationId = cleanConversationId;
    const targetDoctorId = doctor.id;
    const targetUserId = authUser.id;

    // 4. Create transform stream to proxy SSE to client, parse citations, and persist assistant response
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    let accumulatedAnswer = "";
    let extractedCitations: MedicalRagCitation[] = [];
    let isPersisted = false;

    const stream = new ReadableStream({
      async start(controller) {
        // Emit initial start event
        controller.enqueue(
          encoder.encode(
            `event: start\ndata: ${JSON.stringify({
              conversationId: cleanConversationId,
              userMessageId: userMessage.id,
            })}\n\n`
          )
        );

        const reader = ssStreamResponse.body!.getReader();
        let buffer = "";

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const parts = buffer.split("\n\n");
            buffer = parts.pop() || "";

            for (const part of parts) {
              const trimmed = part.trim();
              if (!trimmed) continue;

              const lines = trimmed.split("\n");
              let eventType = "message";
              let dataStr = "";

              for (const line of lines) {
                if (line.startsWith("event: ")) {
                  eventType = line.slice(7).trim();
                } else if (line.startsWith("data: ")) {
                  dataStr = line.slice(6).trim();
                }
              }

              if (eventType === "token") {
                try {
                  const parsed = JSON.parse(dataStr);
                  const tokenText = parsed.text || "";
                  accumulatedAnswer += tokenText;
                  // Forward token to browser
                  controller.enqueue(encoder.encode(`event: token\ndata: ${JSON.stringify({ text: tokenText })}\n\n`));
                } catch {
                  // ignore json parse error
                }
              } else if (eventType === "citations") {
                try {
                  const parsed = JSON.parse(dataStr);
                  extractedCitations = parsed.citations || [];
                } catch {
                  // ignore
                }
              } else if (eventType === "done") {
                try {
                  const parsed = JSON.parse(dataStr);
                  if (parsed.answer && !accumulatedAnswer) {
                    accumulatedAnswer = parsed.answer;
                  }
                  if (parsed.citations && extractedCitations.length === 0) {
                    extractedCitations = parsed.citations;
                  }
                } catch {
                  // ignore
                }
              } else if (eventType === "error") {
                controller.enqueue(encoder.encode(`event: error\ndata: ${dataStr}\n\n`));
                controller.close();
                return;
              }
            }
          }

          // Search Sphere finished streaming tokens and citations
          // Defense-in-depth: Validate citations against database
          if (extractedCitations && extractedCitations.length > 0) {
            const citedDocIds = Array.from(
              new Set(extractedCitations.map((c) => c.documentId).filter(Boolean))
            );

            const matchingDocs = await prisma.medicalDocument.findMany({
              where: {
                id: { in: citedDocIds as string[] },
                patientId: targetPatientId,
              },
              select: { id: true },
            });

            const matchingDocIdSet = new Set(matchingDocs.map((d) => d.id));
            const hasInvalidCitation = citedDocIds.some((id) => !matchingDocIdSet.has(id));

            if (hasInvalidCitation) {
              console.error(
                `[SECURITY ANOMALY] Search Sphere returned cross-patient citations for patient ${targetPatientId}`
              );
              await logAudit(
                targetUserId,
                "MEDICAL_CHAT_SECURITY_ANOMALY",
                {
                  patientId: targetPatientId,
                  doctorId: targetDoctorId,
                  conversationId: targetConversationId,
                  reason: "CROSS_PATIENT_CITATION_DETECTED",
                },
                "MEDICAL_RECORD"
              );

              controller.enqueue(
                encoder.encode(
                  `event: error\ndata: ${JSON.stringify({
                    message: "Security validation failed: invalid citation references detected",
                  })}\n\n`
                )
              );
              controller.close();
              return;
            }
          }

          // Citations valid. Persist ASSISTANT message now!
          const assistantMessage = await prisma.medicalAiMessage.create({
            data: {
              conversationId: targetConversationId,
              role: "ASSISTANT",
              content: accumulatedAnswer || "No clinical response generated.",
              citations: extractedCitations as any,
              status: "COMPLETE",
            },
          });
          isPersisted = true;

          await prisma.medicalAiConversation.update({
            where: { id: targetConversationId },
            data: { updatedAt: new Date() },
          });

          await logAccess(
            targetUserId,
            targetPatientId,
            "MEDICAL_CHAT_MESSAGE_SENT",
            "MEDICAL_RECORD"
          );

          await logAudit(
            targetUserId,
            "MEDICAL_CHAT_RESPONSE_GENERATED",
            {
              patientId: targetPatientId,
              conversationId: targetConversationId,
              citationCount: extractedCitations.length,
            },
            "MEDICAL_RECORD"
          );

          // Emit citations and done events with DB assistant message id
          controller.enqueue(
            encoder.encode(
              `event: citations\ndata: ${JSON.stringify({ citations: extractedCitations })}\n\n`
            )
          );
          controller.enqueue(
            encoder.encode(
              `event: done\ndata: ${JSON.stringify({ messageId: assistantMessage.id })}\n\n`
            )
          );
          controller.close();
        } catch (streamErr: any) {
          console.error("Error reading or processing stream:", streamErr);
          if (!isPersisted) {
            // Streaming failed mid-way: do NOT persist incomplete assistant message as complete.
            // Persist as FAILED so user message remains and retry is permitted
            try {
              if (accumulatedAnswer) {
                await prisma.medicalAiMessage.create({
                  data: {
                    conversationId: targetConversationId,
                    role: "ASSISTANT",
                    content: accumulatedAnswer,
                    status: "FAILED",
                  },
                });
              }
            } catch {
              // ignore
            }
          }
          controller.enqueue(
            encoder.encode(
              `event: error\ndata: ${JSON.stringify({
                message: "Unable to generate answer",
              })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error: any) {
    console.error("Medical chat stream route error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to initiate chat stream" },
      { status: 500 }
    );
  }
}
