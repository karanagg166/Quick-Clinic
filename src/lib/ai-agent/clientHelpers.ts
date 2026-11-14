import {
  AgentThread,
  AgentThreadSummary,
  MAX_AGENT_MESSAGE_LENGTH,
} from "./types";

export interface ValidationResult {
  valid: boolean;
  sanitized: string;
  error?: string;
}

export function validateAgentMessage(raw: string): ValidationResult {
  if (typeof raw !== "string") {
    return { valid: false, sanitized: "", error: "Message must be text." };
  }

  const sanitized = raw.trim();
  if (!sanitized) {
    return {
      valid: false,
      sanitized: "",
      error: "Please enter a message before sending.",
    };
  }

  if (sanitized.length > MAX_AGENT_MESSAGE_LENGTH) {
    return {
      valid: false,
      sanitized,
      error: `Message exceeds the ${MAX_AGENT_MESSAGE_LENGTH} character limit.`,
    };
  }

  for (const char of sanitized) {
    const code = char.charCodeAt(0);
    if (code < 32 && code !== 10 && code !== 13 && code !== 9) {
      return {
        valid: false,
        sanitized,
        error: "Message contains invalid control characters.",
      };
    }
  }

  return { valid: true, sanitized };
}

export function generateIdempotencyKey(prefix = "qc_agent"): string {
  const cleanPrefix = prefix.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 20);
  const randomPart = crypto.randomUUID().replace(/-/g, "");
  return `${cleanPrefix}_${randomPart}`.slice(0, 128);
}

export function deriveThreadTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "New conversation";
  return cleaned.length > 48 ? `${cleaned.slice(0, 45)}...` : cleaned;
}

export function summarizeThread(thread: AgentThread): AgentThreadSummary {
  const pendingApprovals = thread.messages.filter(
    (message) =>
      message.approvalRequest?.status === "PENDING" &&
      new Date(message.approvalRequest.expiresAt).getTime() > Date.now()
  ).length;

  return {
    threadId: thread.threadId,
    title: thread.title,
    role: thread.role,
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    messageCount: thread.messages.length,
    pendingApprovals,
  };
}

export async function parseAgentError(
  response: Response,
  fallback: string
): Promise<string> {
  if (response.status === 401) {
    return "Please log in to use the AI assistant.";
  }
  if (response.status === 403) {
    return "You are not authorized to perform this action.";
  }
  if (response.status === 429) {
    return "Too many requests. Please try again later.";
  }

  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Fall back to safe generic message.
  }

  return fallback;
}
