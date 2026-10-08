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
  sanitizeCitations,
} from "@/lib/search-sphere-client";
import { getOrCreateRequestId, runWithRequestId } from "@/lib/correlation-id";
import { checkDoctorMedicalRateLimit } from "@/lib/rate-limiter";
import {
  acquireConversationLock,
  releaseConversationLock,
  checkAndSetMessageIdempotency,
} from "@/lib/medical-chat-guard";
import { sanitizeErrorMessage } from "@/lib/error-sanitizer";

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
  clientMessageId: z.string().trim().max(128).optional(),
});

function generateDeterministicTitle(text: string): string {
  const clean = text.replace(/[^\w\s]/gi, "").trim();
  const words = clean.split(/\s+/).slice(0, 5).join(" ");
  if (!words) return "Medical Consultation";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export async function POST(req: NextRequest, { params }: RouteParams) {
  const requestId = getOrCreateRequestId(req);

  return runWithRequestId(requestId, async () => {
    let cleanConversationId: string | null = null;
    let lockAcquired = false;

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

      // Rate limiting per doctor identity
      const rateLimit = await checkDoctorMedicalRateLimit(doctor.id, "stream");
      if (!rateLimit.allowed) {
        return NextResponse.json(
          { error: "Too many requests. Please slow down and try again later." },
          {
            status: 429,
            headers: {
              "Retry-After": rateLimit.resetSeconds.toString(),
              "X-RateLimit-Limit": rateLimit.limit.toString(),
              "X-RateLimit-Remaining": rateLimit.remaining.toString(),
            },
          }
        );
      }

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

      const { message: userText, limit = 8, clientMessageId } = parsed.data;

      // Idempotency check: prevent duplicate send on double-click / network retry
      if (clientMessageId) {
        const isUnique = await checkAndSetMessageIdempotency(cleanConversationId, clientMessageId);
        if (!isUnique) {
          return NextResponse.json(
            { error: "Duplicate message submission detected. A request with this ID was already received." },
            { status: 409 }
          );
        }
      }

      // Concurrency lock: prevent simultaneous streaming on same conversation
      lockAcquired = await acquireConversationLock(cleanConversationId, 60);
      if (!lockAcquired) {
        return NextResponse.json(
          { error: "A response is already being generated for this conversation. Please wait for it to complete." },
          { status: 409 }
        );
      }

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
      let ssStreamResponse: Response;
      try {
        ssStreamResponse = await openPatientMedicalChatStream({
          patientId: cleanPatientId,
          message: userText,
          history: historyPayload,
          limit,
        }, { signal: req.signal });
      } catch (streamInitErr) {
        await releaseConversationLock(cleanConversationId);
        lockAcquired = false;
        const sanitized = sanitizeErrorMessage(
          streamInitErr,
          "Medical AI chat is temporarily unavailable."
        );
        return NextResponse.json({ error: sanitized }, { status: 500 });
      }

      if (!ssStreamResponse.body) {
        await releaseConversationLock(cleanConversationId);
        lockAcquired = false;
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
      let streamMode: string | null = null;
      let isPersisted = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

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

          reader = ssStreamResponse.body!.getReader();
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
                    extractedCitations = sanitizeCitations(parsed.citations || []);
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
                      extractedCitations = sanitizeCitations(parsed.citations);
                    }
                    if (parsed.mode) {
                      streamMode = parsed.mode;
                    }
                  } catch {
                    // ignore
                  }
                } else if (eventType === "error") {
                  controller.enqueue(
                    encoder.encode(
                      `event: error\ndata: ${JSON.stringify({
                        message: "Medical AI stream encountered an error.",
                      })}\n\n`
                    )
                  );
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
                  `[SECURITY ANOMALY][RequestId: ${requestId}] Search Sphere returned cross-patient citations for patient ${targetPatientId}`
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

            if (streamMode === "STRUCTURED") {
              await logAudit(
                targetUserId,
                "MEDICAL_STRUCTURED_QUERY",
                {
                  patientId: targetPatientId,
                  conversationId: targetConversationId,
                  citationCount: extractedCitations.length,
                },
                "MEDICAL_RECORD"
              );
            } else if (streamMode === "HYBRID") {
              await logAudit(
                targetUserId,
                "MEDICAL_HYBRID_QUERY",
                {
                  patientId: targetPatientId,
                  conversationId: targetConversationId,
                  citationCount: extractedCitations.length,
                },
                "MEDICAL_RECORD"
              );
            }

            // Emit sanitized citations and done events with DB assistant message id
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
            console.error(`[RequestId: ${requestId}] Error reading or processing stream:`, streamErr);
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
          } finally {
            await releaseConversationLock(targetConversationId);
          }
        },
        async cancel(reason) {
          // Client disconnected midway!
          if (reader) {
            try {
              await reader.cancel(reason);
            } catch {
              // ignore
            }
          }
          if (!isPersisted && accumulatedAnswer) {
            try {
              await prisma.medicalAiMessage.create({
                data: {
                  conversationId: targetConversationId,
                  role: "ASSISTANT",
                  content: accumulatedAnswer,
                  status: "FAILED",
                },
              });
            } catch (e) {
              console.error("Failed to save disconnected assistant message:", e);
            }
          }
          await releaseConversationLock(targetConversationId);
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
      console.error(`[RequestId: ${requestId}] Medical chat stream route error:`, error);
      if (lockAcquired && cleanConversationId) {
        await releaseConversationLock(cleanConversationId);
      }
      const sanitized = sanitizeErrorMessage(error, "Failed to initiate chat stream");
      return NextResponse.json(
        { error: sanitized },
        { status: 500 }
      );
    }
  });
}
