/**
 * Sanitizes technical and infrastructure error messages before returning them to client browsers.
 * Replaces upstream database/vector/AI provider error messages with user-safe, PHI-free responses.
 */

const LEAKY_PATTERNS = [
  /connection refused/i,
  /econnrefused/i,
  /cohere/i,
  /qdrant/i,
  /search sphere/i,
  /supabase/i,
  /dramatiq/i,
  /rabbitmq/i,
  /fetch failed/i,
  /abort/i,
  /timeout/i,
  /network/i,
  /secret/i,
  /api key/i,
  /bearer/i,
  /internal server error/i,
  /failed to fetch/i,
  /socket/i,
  /prisma/i,
  /postgres/i,
];

export function sanitizeErrorMessage(
  error: unknown,
  fallbackMessage: string
): string {
  if (!error) return fallbackMessage;

  const rawMessage =
    typeof error === "string"
      ? error
      : error instanceof Error
      ? error.message
      : typeof (error as any)?.message === "string"
      ? (error as any).message
      : "";

  if (!rawMessage) return fallbackMessage;

  // Check if any leaky pattern matches
  const containsLeakyDetail = LEAKY_PATTERNS.some((pattern) =>
    pattern.test(rawMessage)
  );

  if (containsLeakyDetail) {
    return fallbackMessage;
  }

  // If the message is a brief, standard application error, allow it
  if (rawMessage.length < 150) {
    return rawMessage;
  }

  return fallbackMessage;
}
