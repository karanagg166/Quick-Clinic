import { describe, it, expect } from "vitest";
import {
  timeStringToMinutes,
  validateDaySlots,
  validateWeeklySchedule,
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
});
