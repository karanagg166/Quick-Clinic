import { afterEach, describe, expect, it, vi } from "vitest";
import { MedicalReleaseSession } from "@/lib/medical-release-http";

afterEach(() => vi.useRealTimers());
describe("bounded synthetic medical release HTTP", () => {
  it("keeps authenticated cookies private, uses fixed origins and rejects redirects", async () => {
    const transport = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          new Response("{}", {
            headers: { "Set-Cookie": "token=synthetic.header.signature; HttpOnly; Secure" },
          }),
        ),
      );
    const session = new MedicalReleaseSession("clinic", transport);
    const login = await session.request("POST", "/api/user/login", {
      email: "synthetic@example.com",
      password: "synthetic-test-only",
    });
    expect(JSON.stringify(login)).not.toContain("synthetic.header.signature");
    await session.request("GET", "/api/patients/me/medical-documents");
    expect(transport.mock.calls[1][1].headers.Cookie).toBe("token=synthetic.header.signature");
    expect(transport.mock.calls[1][0].origin).toBe("https://quick-clinic-nine.vercel.app");
    expect(transport.mock.calls[1][1]).toMatchObject({ redirect: "error", cache: "no-store" });
    const backend = new MedicalReleaseSession("search", transport);
    await backend.request("GET", "/health");
    expect(transport.mock.calls[2][1].headers).not.toHaveProperty("Cookie");
  });
  it("fails a successful login without its authenticated cookie", async () => {
    const session = new MedicalReleaseSession(
      "clinic",
      vi.fn().mockResolvedValue(new Response("{}")),
    );
    await expect(session.request("POST", "/api/user/login", {})).rejects.toThrow("cookie");
  });
  it.each(["//example.com/private", "https://example.com", "/\\example.com", "/x\nprivate"])(
    "rejects unsafe path %s without transport",
    async (path) => {
      const transport = vi.fn();
      const session = new MedicalReleaseSession("clinic", transport);
      await expect(session.request("GET", path)).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, NaN, Infinity, 65001])(
    "rejects invalid deadline %s without transport",
    async (timeoutMs) => {
      const transport = vi.fn();
      const session = new MedicalReleaseSession("clinic", transport);
      await expect(session.request("GET", "/health", undefined, timeoutMs)).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it.each(["headers", "body"])("bounds stalled response %s and never retries", async (stage) => {
    vi.useFakeTimers();
    const transport = vi
      .fn()
      .mockImplementation(() =>
        stage === "headers"
          ? new Promise(() => {})
          : Promise.resolve(new Response(new ReadableStream())),
      );
    const session = new MedicalReleaseSession("clinic", transport);
    const rejection = expect(session.request("GET", "/health", undefined, 500)).rejects.toThrow(
      "deadline",
    );
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
    expect(transport).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("retains HTTP failure codes for strict assertions and caps response bytes", async () => {
    const transport = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(new Response('{"error":"synthetic"}', { status: 503 })),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response("x".repeat(262145))));
    const session = new MedicalReleaseSession("clinic", transport);
    expect((await session.request("DELETE", "/api/synthetic")).status).toBe(503);
    await expect(session.request("GET", "/api/synthetic")).rejects.toThrow("bound");
  });
  it("preserves complete SSE bytes without assuming that HTTP 200 means completion", async () => {
    const transport = vi
      .fn()
      .mockResolvedValue(
        new Response('data: {"type":"token","text":"synthetic"}\n\ndata: [DONE]\n\n', {
          headers: { "Content-Type": "text/event-stream" },
        }),
      );
    const result = await new MedicalReleaseSession("clinic", transport).request(
      "POST",
      "/api/synthetic",
      {},
      65000,
    );
    expect(result.contentType).toBe("text/event-stream");
    expect(result.text).toContain("[DONE]");
    expect(result.value).toBeNull();
  });
});
