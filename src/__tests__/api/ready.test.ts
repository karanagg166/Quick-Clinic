import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET as readyGet } from "@/app/api/ready/route";
import { GET as healthReadyGet } from "@/app/api/health/ready/route";
import * as prismaModule from "@/lib/prisma";

describe("Quick-Clinic /api/ready & /api/health/ready endpoints", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 200 with status ready when database check succeeds", async () => {
    vi.spyOn(prismaModule, "checkDatabaseReadiness").mockResolvedValue({
      ok: true,
      latencyMs: 12,
    });

    const res = await readyGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ready");
    expect(data.database).toBe("connected");
    expect(data.service).toBe("quick-clinic-web");
    expect(data.latencyMs).toBe(12);
  });

  it("returns 503 with generic error code and no raw exception leaks when database is unreachable", async () => {
    vi.spyOn(prismaModule, "checkDatabaseReadiness").mockResolvedValue({
      ok: false,
      latencyMs: 7001,
      error: "password authentication failed for user 'neondb_owner' at host 'ep-summer-paper.neon.tech'",
    });

    const res = await readyGet();
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe("unready");
    expect(data.database).toBe("disconnected");
    expect(data.error).toBe("DATABASE_UNAVAILABLE");
    expect(data.requestId).toBeDefined();
    // Verify no secret or internal host leakage
    expect(JSON.stringify(data)).not.toContain("neondb_owner");
    expect(JSON.stringify(data)).not.toContain("neon.tech");
  });

  it("/api/health/ready alias produces identical readiness contract", async () => {
    vi.spyOn(prismaModule, "checkDatabaseReadiness").mockResolvedValue({
      ok: true,
      latencyMs: 15,
    });

    const res = await healthReadyGet();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ready");
    expect(data.database).toBe("connected");
  });
});
