import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";

describe("Health Check API Route", () => {
  it("returns 200 OK with expected JSON structure", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("quick-clinic-web");
    expect(body.timestamp).toBeDefined();
  });
});
