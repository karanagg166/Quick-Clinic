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

  it("returns 503 with status unready when database is unreachable or times out", async () => {
    vi.spyOn(prismaModule, "checkDatabaseReadiness").mockResolvedValue({
      ok: false,
      latencyMs: 7001,
      error: "Database check timed out after 7000ms",
    });

    const res = await readyGet();
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe("unready");
    expect(data.database).toBe("disconnected");
    expect(data.error).toContain("timed out");
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
