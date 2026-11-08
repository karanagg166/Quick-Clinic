/** Bounded synthetic-release transport. Cookies and response contents stay in memory. */
const ORIGINS = {
  clinic: "https://quick-clinic-nine.vercel.app",
  search: "https://search-sphere-api.onrender.com",
} as const;
type Method = "GET" | "POST" | "DELETE";

export class MedicalReleaseDeadlineError extends Error {
  constructor() { super("Release request deadline exceeded."); }
}

export class MedicalReleaseSession {
  private cookie = "";
  constructor(
    private readonly target: keyof typeof ORIGINS = "clinic",
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!Object.hasOwn(ORIGINS, target)) throw new Error("Invalid release target.");
  }

  async request(
    method: Method,
    path: string,
    body?: unknown,
    timeoutMs = method === "POST" ? 45000 : 15000,
  ) {
    if (
      !Number.isFinite(timeoutMs) ||
      timeoutMs <= 0 ||
      timeoutMs > 65000 ||
      !/^\/(?!\/)/.test(path) ||
      /[\r\n\0]/.test(path)
    ) {
      throw new Error("Invalid bounded release request.");
    }
    const url = new URL(path, ORIGINS[this.target]);
    if (url.origin !== ORIGINS[this.target]) throw new Error("Invalid release origin.");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const expiry = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new MedicalReleaseDeadlineError());
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const headers: Record<string, string> = {
            Accept: "application/json, text/event-stream",
            "User-Agent": "QuickClinicSyntheticRelease/1",
          };
          if (this.cookie) headers.Cookie = this.cookie;
          let encoded: string | FormData | undefined;
          if (body instanceof FormData) encoded = body;
          else if (body !== undefined) {
            headers["Content-Type"] = "application/json";
            encoded = JSON.stringify(body);
          }
          response = await this.transport(url, {
            method,
            body: encoded,
            headers,
            signal: controller.signal,
            redirect: "error",
            cache: "no-store",
          });
          if (method === "POST" && path === "/api/user/login" && response.status === 200) {
            const cookies = response.headers
              .getSetCookie()
              .filter((cookie) => cookie.startsWith("token="));
            if (
              cookies.length !== 1 ||
              !/^token=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
                cookies[0].split(";")[0],
              )
            )
              throw new Error("Missing valid release login cookie.");
            this.cookie = cookies[0].split(";")[0];
          }
          reader = response.body?.getReader();
          const parts: Uint8Array[] = [];
          let length = 0;
          try {
            if (reader)
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                length += part.value.byteLength;
                if (length > 262144) throw new Error("Release response exceeded its bound.");
                parts.push(part.value);
              }
          } finally {
            if (reader) void reader.cancel().catch(() => undefined);
          }
          const text = Buffer.concat(parts).toString("utf8");
          let value: unknown = null;
          try {
            value = JSON.parse(text);
          } catch {
            /* SSE and non-JSON errors remain explicit. */
          }
          return {
            status: response.status,
            value,
            text,
            contentType: response.headers.get("Content-Type") || "",
          };
        })(),
        expiry,
      ]);
    } catch (error) {
      if (controller.signal.aborted) throw new MedicalReleaseDeadlineError();
      throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
      if (reader) void reader.cancel().catch(() => undefined);
      if (response?.body && !response.body.locked)
        void response.body.cancel().catch(() => undefined);
    }
  }
}
