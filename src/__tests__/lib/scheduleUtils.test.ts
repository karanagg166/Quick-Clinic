import { describe, it, expect } from "vitest";
import {
  timeStringToMinutes,
  validateDaySlots,
  validateWeeklySchedule,
  calculateTimelineBlocks,
  calculateDayMetrics,
} from "@/lib/scheduleUtils";

describe("scheduleUtils", () => {
  describe("timeStringToMinutes", () => {
    it("converts valid 24h time strings to minutes", () => {
      expect(timeStringToMinutes("00:00")).toBe(0);
      expect(timeStringToMinutes("02:00")).toBe(120);
      expect(timeStringToMinutes("03:30")).toBe(210);
      expect(timeStringToMinutes("15:00")).toBe(900);
      expect(timeStringToMinutes("23:59")).toBe(1439);
    });

    it("throws on invalid time string formats", () => {
      expect(() => timeStringToMinutes("")).toThrow();
      expect(() => timeStringToMinutes("25:00")).toThrow();
      expect(() => timeStringToMinutes("12:65")).toThrow();
      expect(() => timeStringToMinutes("invalid")).toThrow();
    });
  });

  describe("validateDaySlots", () => {
    it("returns valid for empty slots array", () => {
      const res = validateDaySlots("Monday", []);
      expect(res.isValid).toBe(true);
    });

    it("returns valid for single valid slot", () => {
      const res = validateDaySlots("Monday", [
        { slotNo: 1, start: "09:00", end: "12:00" },
      ]);
      expect(res.isValid).toBe(true);
    });

    it("returns valid for non-overlapping adjacent/consecutive slots", () => {
      const res = validateDaySlots("Monday", [
        { slotNo: 1, start: "09:00", end: "12:00" },
        { slotNo: 2, start: "12:00", end: "15:00" },
        { slotNo: 3, start: "16:00", end: "19:00" },
      ]);
      expect(res.isValid).toBe(true);
    });

    it("rejects slot where start time is equal or after end time", () => {
      const res = validateDaySlots("Monday", [
        { slotNo: 1, start: "15:00", end: "02:00" },
      ]);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("start time (15:00) must be before end time (02:00)");
    });

    it("rejects overlapping slots (e.g. 02:00-15:00 and 03:00-04:00)", () => {
      const res = validateDaySlots("Monday", [
        { slotNo: 1, start: "02:00", end: "15:00" },
        { slotNo: 2, start: "03:00", end: "04:00" },
      ]);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Overlapping slots detected on Monday");
      expect(res.error).toContain("[02:00 - 15:00]");
      expect(res.error).toContain("[03:00 - 04:00]");
    });

    it("rejects partial overlap slots (e.g. 09:00-11:00 and 10:30-12:30)", () => {
      const res = validateDaySlots("Monday", [
        { slotNo: 1, start: "09:00", end: "11:00" },
        { slotNo: 2, start: "10:30", end: "12:30" },
      ]);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Overlapping slots detected on Monday");
    });
  });

  describe("validateWeeklySchedule", () => {
    it("validates full weekly schedule without overlap", () => {
      const schedule = [
        {
          day: "Monday",
          slots: [
            { slotNo: 1, start: "09:00", end: "12:00" },
            { slotNo: 2, start: "14:00", end: "17:00" },
          ],
        },
        {
          day: "Tuesday",
          slots: [{ slotNo: 1, start: "10:00", end: "16:00" }],
        },
      ];
      const res = validateWeeklySchedule(schedule);
      expect(res.isValid).toBe(true);
    });

    it("rejects weekly schedule if any day has overlapping slots", () => {
      const schedule = [
        {
          day: "Monday",
          slots: [{ slotNo: 1, start: "09:00", end: "12:00" }],
        },
        {
          day: "Tuesday",
          slots: [
            { slotNo: 1, start: "02:00", end: "15:00" },
            { slotNo: 2, start: "03:00", end: "04:00" },
          ],
        },
      ];
      const res = validateWeeklySchedule(schedule);
      expect(res.isValid).toBe(false);
      expect(res.error).toContain("Overlapping slots detected on Tuesday");
    });
  });

  describe("calculateTimelineBlocks", () => {
    it("returns empty array for empty slots", () => {
      const blocks = calculateTimelineBlocks([]);
      expect(blocks).toEqual([]);
    });

    it("aggregates consecutive booked slots into a busy block", () => {
      const slots = [
        {
          id: "s1",
          startTime: "2026-08-15T09:00:00.000Z",
          endTime: "2026-08-15T09:10:00.000Z",
          status: "BOOKED" as const,
        },
        {
          id: "s2",
          startTime: "2026-08-15T09:10:00.000Z",
          endTime: "2026-08-15T09:20:00.000Z",
          status: "BOOKED" as const,
        },
      ];

      const blocks = calculateTimelineBlocks(slots);
      expect(blocks.length).toBe(1);
      expect(blocks[0].type).toBe("BUSY");
      expect(blocks[0].slotCount).toBe(2);
      expect(blocks[0].bookedCount).toBe(2);
      expect(blocks[0].durationMinutes).toBe(20);
    });

    it("aggregates transition between busy and free slots into distinct blocks", () => {
      const slots = [
        // 9:00 - 9:20 Busy
        {
          id: "s1",
          startTime: "2026-08-15T09:00:00.000Z",
          endTime: "2026-08-15T09:10:00.000Z",
          status: "BOOKED" as const,
        },
        {
          id: "s2",
          startTime: "2026-08-15T09:10:00.000Z",
          endTime: "2026-08-15T09:20:00.000Z",
          status: "BOOKED" as const,
        },
        // 9:20 - 9:40 Free
        {
          id: "s3",
          startTime: "2026-08-15T09:20:00.000Z",
          endTime: "2026-08-15T09:30:00.000Z",
          status: "AVAILABLE" as const,
        },
        {
          id: "s4",
          startTime: "2026-08-15T09:30:00.000Z",
          endTime: "2026-08-15T09:40:00.000Z",
          status: "AVAILABLE" as const,
        },
        // 9:40 - 10:00 Break / Unavailable
        {
          id: "s5",
          startTime: "2026-08-15T09:40:00.000Z",
          endTime: "2026-08-15T09:50:00.000Z",
          status: "UNAVAILABLE" as const,
        },
      ];

      const blocks = calculateTimelineBlocks(slots);
      expect(blocks.length).toBe(3);
      expect(blocks[0].type).toBe("BUSY");
      expect(blocks[1].type).toBe("FREE");
      expect(blocks[2].type).toBe("BLOCKED");
    });
  });

  describe("calculateDayMetrics", () => {
    it("computes accurate counts, minutes and occupancy percentages", () => {
      const slots = [
        {
          id: "s1",
          startTime: "2026-08-15T09:00:00.000Z",
          endTime: "2026-08-15T09:10:00.000Z",
          status: "BOOKED" as const,
        },
        {
          id: "s2",
          startTime: "2026-08-15T09:10:00.000Z",
          endTime: "2026-08-15T09:20:00.000Z",
          status: "AVAILABLE" as const,
        },
        {
          id: "s3",
          startTime: "2026-08-15T09:20:00.000Z",
          endTime: "2026-08-15T09:30:00.000Z",
          status: "UNAVAILABLE" as const,
        },
        {
          id: "s4",
          startTime: "2026-08-15T09:30:00.000Z",
          endTime: "2026-08-15T09:40:00.000Z",
          status: "ON_LEAVE" as const,
        },
      ];

      const metrics = calculateDayMetrics(slots);
      expect(metrics.totalSlots).toBe(4);
      expect(metrics.bookedCount).toBe(1);
      expect(metrics.availableCount).toBe(1);
      expect(metrics.unavailableCount).toBe(1);
      expect(metrics.onLeaveCount).toBe(1);
      expect(metrics.totalWorkingMinutes).toBe(40);
      expect(metrics.freeMinutes).toBe(10);
      expect(metrics.busyMinutes).toBe(10);
      expect(metrics.occupancyPercentage).toBe(25);
    });
  });
});
