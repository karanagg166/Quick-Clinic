/**
 * Socket.IO internal server-to-server publishing helper.
 * Attaches the internal secret header so that the socket-server accepts
 * notifications and realtime updates from authoritative Next.js API routes.
 */
export async function publishToSocketServer<T = unknown>(
  path: string,
  payload: Record<string, unknown>
): Promise<T | null> {
  const socketUrl =
    process.env.SOCKET_SERVER_URL ||
    process.env.NEXT_PUBLIC_SOCKET_URL ||
    (process.env.NODE_ENV !== "production" ? "http://localhost:4000" : "");

  if (!socketUrl) {
    return null;
  }

  const internalSecret =
    process.env.INTERNAL_SECRET || process.env.INTERNAL_API_SECRET || process.env.JWT_SECRET || "";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const targetUrl = `${socketUrl.replace(/\/$/, "")}${normalizedPath}`;

    const res = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": internalSecret,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[SocketPublisher] ${normalizedPath} returned HTTP ${res.status}`);
      return null;
    }

    return (await res.json().catch(() => null)) as T;
  } catch (err: unknown) {
    // Graceful handling: failing to publish realtime notification must never crash or rollback database transaction
    const isAbort = err instanceof Error && err.name === "AbortError";
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(
      `[SocketPublisher] Unable to publish to ${path}:`,
      isAbort ? "Request timed out" : msg
    );
    return null;
  }
}
