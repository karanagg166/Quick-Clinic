import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CLINIC_TIMEZONE,
  addDaysToDateString,
  formatCalendarDate,
  getClinicDateParts,
  getClinicYearMonth,
  getTodayInClinicTimezone,
  isLegacySlot,
  localDateAndTimeToUtc,
  resetServerClockOffset,
  setServerClockOffsetFromIso,
  utcToLocalDateAndTime,
} from '@/lib/dateUtils';

describe('dateUtils clinic timezone standardization (Asia/Kolkata)', () => {
  afterEach(() => {
    resetServerClockOffset();
  });

  it('derives clinic calendar date across IST midnight boundary (18:29Z vs 18:30Z)', () => {
    expect(getTodayInClinicTimezone(new Date('2026-11-14T18:29:00.000Z'))).toBe('2026-11-14');
    expect(getTodayInClinicTimezone(new Date('2026-11-14T18:30:00.000Z'))).toBe('2026-11-15');
    expect(getTodayInClinicTimezone(new Date('2026-12-31T18:30:00.000Z'))).toBe('2027-01-01');
  });

  it('computes clinic year, month, and day-of-week accurately in IST', () => {
    const instant = new Date('2026-11-30T18:30:00.000Z'); // Dec 1, 2026 00:00 IST (Tuesday)
    expect(getClinicYearMonth(instant)).toEqual({ year: 2026, month: 12 });
    expect(getClinicDateParts(instant)).toEqual({
      year: 2026,
      month: 12,
      day: 1,
      dayOfWeek: 2,
    });
  });

  it('performs pure calendar arithmetic without local timezone shifts', () => {
    expect(addDaysToDateString('2026-11-15', 1)).toBe('2026-11-16');
    expect(addDaysToDateString('2026-11-15', -1)).toBe('2026-11-14');
    expect(addDaysToDateString('2026-11-30', 1)).toBe('2026-12-01');
  });

  it('formats YYYY-MM-DD calendar strings without previous-day wrap', () => {
    expect(formatCalendarDate('2026-11-15')).toContain('November 15, 2026');
  });

  it('converts between IST clinic wall time and canonical UTC instants', () => {
    const utc = localDateAndTimeToUtc('2026-11-15', '00:00', DEFAULT_CLINIC_TIMEZONE);
    expect(utc.toISOString()).toBe('2026-11-14T18:30:00.000Z');

    const local = utcToLocalDateAndTime(utc, DEFAULT_CLINIC_TIMEZONE);
    expect(local.date).toBe('2026-11-15');
    expect(local.time).toBe('00:00');
    expect(local.timeZoneName).toBe('IST');
  });

  it('supports server clock synchronization offset cleanly', () => {
    const nowMs = Date.parse('2026-11-14T18:29:00.000Z');
    setServerClockOffsetFromIso('2026-11-14T18:30:00.000Z', nowMs);
    expect(getTodayInClinicTimezone(new Date(nowMs + 60_000))).toBe('2026-11-15');
  });

  it('preserves legacy slot detection', () => {
    expect(isLegacySlot({ createdAt: '2026-10-01T00:00:00.000Z' })).toBe(true);
    expect(isLegacySlot({ createdAt: '2026-11-15T00:00:00.000Z' })).toBe(false);
  });
});
