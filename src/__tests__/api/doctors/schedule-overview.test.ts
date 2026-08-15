import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/doctors/[doctorId]/schedule/overview/route";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    slot: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    schedule: {
      findUnique: vi.fn(),
    },
    leave: {
      findMany: vi.fn(),
    },
  },
}));

describe("Doctor Schedule Overview API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/doctors/[doctorId]/schedule/overview - Day View", () => {
    it("returns slots, timelineBlocks and metrics for a specific date", async () => {
      vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([
        {
          id: "slot_1",
          doctorId: "doc_1",
          date: new Date("2026-08-15T00:00:00.000Z"),
          startTime: new Date("2026-08-15T09:00:00.000Z"),
          endTime: new Date("2026-08-15T09:10:00.000Z"),
          status: "BOOKED",
          appointment: {
            id: "apt_1",
            status: "CONFIRMED",
            patient: {
              user: {
                id: "u_pat",
                name: "John Doe",
                email: "john@example.com",
                phoneNo: "9988776655",
              },
            },
          },
        },
        {
          id: "slot_2",
          doctorId: "doc_1",
          date: new Date("2026-08-15T00:00:00.000Z"),
          startTime: new Date("2026-08-15T09:10:00.000Z"),
          endTime: new Date("2026-08-15T09:20:00.000Z"),
          status: "AVAILABLE",
          appointment: null,
        },
      ] as any);

      const req = new NextRequest("http://localhost:3000/api/doctors/doc_1/schedule/overview?view=day&date=2026-08-15");
      const res = await GET(req, { params: Promise.resolve({ doctorId: "doc_1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.view).toBe("day");
      expect(data.date).toBe("2026-08-15");
      expect(data.slots.length).toBe(2);
      expect(data.timelineBlocks.length).toBe(2);
      expect(data.metrics.totalSlots).toBe(2);
      expect(data.metrics.bookedCount).toBe(1);
      expect(data.metrics.availableCount).toBe(1);
      expect(data.metrics.occupancyPercentage).toBe(50);
    });
  });

  describe("GET /api/doctors/[doctorId]/schedule/overview - Week View", () => {
    it("returns 7 days breakdown and weekMetrics", async () => {
      vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([
        {
          id: "slot_1",
          doctorId: "doc_1",
          date: new Date("2026-08-17T00:00:00.000Z"),
          startTime: new Date("2026-08-17T09:00:00.000Z"),
          endTime: new Date("2026-08-17T09:10:00.000Z"),
          status: "BOOKED",
          appointment: null,
        },
      ] as any);

      const req = new NextRequest("http://localhost:3000/api/doctors/doc_1/schedule/overview?view=week&startDate=2026-08-17");
      const res = await GET(req, { params: Promise.resolve({ doctorId: "doc_1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.view).toBe("week");
      expect(data.days.length).toBe(7);
      expect(data.weekMetrics.totalSlots).toBe(1);
      expect(data.weekMetrics.totalBooked).toBe(1);
    });
  });

  describe("GET /api/doctors/[doctorId]/schedule/overview - Month View", () => {
    it("returns month calendar days with booking, leave info, firstDayOffset, and statusSummary", async () => {
      vi.mocked(prisma.slot.findMany).mockResolvedValueOnce([
        {
          id: "slot_1",
          date: new Date("2026-08-15T00:00:00.000Z"),
          status: "BOOKED",
        },
        {
          id: "slot_2",
          date: new Date("2026-08-01T00:00:00.000Z"),
          status: "AVAILABLE",
        },
      ] as any);

      vi.mocked(prisma.leave.findMany).mockResolvedValueOnce([
        {
          startDate: new Date("2026-08-20T00:00:00.000Z"),
          endDate: new Date("2026-08-22T23:59:59.999Z"),
        },
      ] as any);

      const req = new NextRequest("http://localhost:3000/api/doctors/doc_1/schedule/overview?view=month&year=2026&month=8");
      const res = await GET(req, { params: Promise.resolve({ doctorId: "doc_1" }) });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.view).toBe("month");
      expect(data.year).toBe(2026);
      expect(data.month).toBe(8);
      expect(data.daysInMonth).toBe(31);
      // August 1, 2026 starts on Saturday (index 6)
      expect(data.firstDayOffset).toBe(6);
      expect(data.days.length).toBe(31);

      // Aug 1 - Saturday with 1 available slot => FREE_WHOLE_DAY
      const day1 = data.days[0];
      expect(day1.dayNumber).toBe(1);
      expect(day1.dayName).toBe("Saturday");
      expect(day1.dayOfWeek).toBe(6);
      expect(day1.statusSummary).toBe("FREE_WHOLE_DAY");

      // Aug 15 - Saturday with 1 booked slot => BOOKED
      const day15 = data.days[14];
      expect(day15.dayNumber).toBe(15);
      expect(day15.bookedCount).toBe(1);
      expect(day15.statusSummary).toBe("BOOKED");

      // Aug 21 - Inside leave range => ON_LEAVE
      const day21 = data.days[20];
      expect(day21.dayNumber).toBe(21);
      expect(day21.isLeave).toBe(true);
      expect(day21.statusSummary).toBe("ON_LEAVE");
    });
  });
});
