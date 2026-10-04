import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/admin/logs/route";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    auditLog: {
      findMany: vi.fn(),
    },
    accessLog: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth", () => ({
  requireAdmin: vi.fn(),
}));

describe("Admin Medical Logs API (GET /api/admin/logs)", () => {
  const adminUser = { id: "admin_1", role: "ADMIN", email: "admin@example.com", name: "System Admin" };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("Role-Based Access Control", () => {
    it("returns 401 when unauthenticated", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/admin/logs");
      const res = await GET(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Unauthorized");
    });

    it("returns 401 when called by a doctor", async () => {
      // requireAdmin returns null for non-admin users
      vi.mocked(requireAdmin).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/admin/logs");
      const res = await GET(req);

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain("Unauthorized");
    });

    it("returns 401 when called by a patient", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(null);

      const req = new NextRequest("http://localhost:3000/api/admin/logs");
      const res = await GET(req);

      expect(res.status).toBe(401);
    });
  });

  describe("Medical Record Log Filtering", () => {
    it("allows admin to retrieve medical access logs with tag=MEDICAL_RECORD", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(adminUser as any);

      const mockAccessLogs = [
        {
          id: "log_acc_1",
          userId: "user_doc_1",
          targetId: "doc_123",
          action: "MEDICAL_DOCUMENT_VIEW",
          tag: "MEDICAL_RECORD",
          createdAt: new Date("2026-10-04T10:00:00Z"),
          user: { id: "user_doc_1", name: "Dr. Sharma", email: "sharma@example.com", role: "DOCTOR" },
        },
      ];

      vi.mocked(prisma.accessLog.findMany).mockResolvedValueOnce(mockAccessLogs as any);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/logs?type=access&tag=MEDICAL_RECORD&action=MEDICAL_DOCUMENT_VIEW"
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.logs.length).toBe(1);
      expect(data.logs[0].action).toBe("MEDICAL_DOCUMENT_VIEW");
      expect(data.logs[0].tag).toBe("MEDICAL_RECORD");
      expect(data.logs[0].targetId).toBe("doc_123");
      expect(data.logs[0].user.name).toBe("Dr. Sharma");

      expect(prisma.accessLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tag: "MEDICAL_RECORD",
            action: { contains: "MEDICAL_DOCUMENT_VIEW", mode: "insensitive" },
          }),
        })
      );
    });

    it("allows admin to retrieve denied-access audit logs with action=MEDICAL_DOCUMENT_ACCESS_DENIED", async () => {
      vi.mocked(requireAdmin).mockResolvedValueOnce(adminUser as any);

      const mockAuditLogs = [
        {
          id: "log_aud_1",
          userId: "user_doc_2",
          action: "MEDICAL_DOCUMENT_ACCESS_DENIED",
          tag: "MEDICAL_RECORD",
          metadata: JSON.stringify({ patientId: "pat_456", doctorId: "doc_2", reason: "NO_ELIGIBLE_APPOINTMENT" }),
          createdAt: new Date("2026-10-04T10:05:00Z"),
          user: { id: "user_doc_2", name: "Dr. Verma", email: "verma@example.com", role: "DOCTOR" },
        },
      ];

      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(mockAuditLogs as any);

      const req = new NextRequest(
        "http://localhost:3000/api/admin/logs?type=audit&tag=MEDICAL_RECORD&action=MEDICAL_DOCUMENT_ACCESS_DENIED"
      );
      const res = await GET(req);

      expect(res.status).toBe(200);
      const data = await res.json();

      expect(data.logs.length).toBe(1);
      expect(data.logs[0].action).toBe("MEDICAL_DOCUMENT_ACCESS_DENIED");
      expect(data.logs[0].tag).toBe("MEDICAL_RECORD");
      expect(data.logs[0].user.name).toBe("Dr. Verma");

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tag: "MEDICAL_RECORD",
            action: { contains: "MEDICAL_DOCUMENT_ACCESS_DENIED", mode: "insensitive" },
          }),
        })
      );
    });
  });
});
