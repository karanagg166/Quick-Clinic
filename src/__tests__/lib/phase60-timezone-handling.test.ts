import { describe, it, expect } from 'vitest';
import {
  parseUTCDate,
  formatDateUTC,
  formatTimeUTC,
  combineDateTimeInUserTimezone,
  formatUTCToUserTimezone,
} from '@/lib/dateUtils';
import {
  timeStringToMinutes,
  validateDaySlots,
  validateWeeklySchedule,
} from '@/lib/scheduleUtils';

describe('Phase 60: Timezone Handling & Date Utilities Test Suite', () => {
  it('60.1 parseUTCDate correctly parses YYYY-MM-DD string as UTC midnight Date', () => {
    const d = parseUTCDate('2026-08-15');
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(7); // 0-indexed August
    expect(d.getUTCDate()).toBe(15);
    expect(d.getUTCHours()).toBe(0);
    expect(d.getUTCMinutes()).toBe(0);
    expect(d.getUTCSeconds()).toBe(0);
  });

  it('60.2 parseUTCDate throws error for invalid date strings', () => {
    expect(() => parseUTCDate('invalid-date')).toThrow('Invalid date string');
    expect(() => parseUTCDate('15-08-2026')).toThrow('Invalid date string');
    expect(() => parseUTCDate('')).toThrow('Invalid date string');
  });

  it('60.3 formatDateUTC and formatTimeUTC format UTC Date instances accurately', () => {
    const d = new Date(Date.UTC(2026, 11, 25, 14, 30, 0));
    expect(formatDateUTC(d)).toBe('2026-12-25');
    expect(formatTimeUTC(d)).toBe('14:30');
  });

  it('60.4 combineDateTimeInUserTimezone combines local date and time strings safely', () => {
    const combined = combineDateTimeInUserTimezone('2026-06-10', '09:45');
    expect(combined).toBeInstanceOf(Date);
    expect(isNaN(combined.getTime())).toBe(false);
  });

  it('60.5 combineDateTimeInUserTimezone throws error for missing or malformed input', () => {
    expect(() => combineDateTimeInUserTimezone('', '09:00')).toThrow();
    expect(() => combineDateTimeInUserTimezone('2026-06-10', '')).toThrow();
    expect(() => combineDateTimeInUserTimezone('invalid', 'invalid')).toThrow();
  });

  it('60.6 formatUTCToUserTimezone returns structured date and time strings', () => {
    const d = new Date(Date.UTC(2026, 3, 5, 10, 15, 0));
    const formatted = formatUTCToUserTimezone(d);
    expect(formatted).toHaveProperty('date');
    expect(formatted).toHaveProperty('time');
    expect(/^\d{4}-\d{2}-\d{2}$/.test(formatted.date)).toBe(true);
    expect(/^\d{2}:\d{2}$/.test(formatted.time)).toBe(true);
  });

  it('60.7 timeStringToMinutes converts 24-hour time strings (00:00 to 23:59) to total minutes correctly', () => {
    expect(timeStringToMinutes('00:00')).toBe(0);
    expect(timeStringToMinutes('09:30')).toBe(9 * 60 + 30); // 570
    expect(timeStringToMinutes('12:00')).toBe(720);
    expect(timeStringToMinutes('23:59')).toBe(1439);
  });

  it('60.8 timeStringToMinutes throws for invalid formats', () => {
    expect(() => timeStringToMinutes('24:00')).toThrow();
    expect(() => timeStringToMinutes('12:60')).toThrow();
    expect(() => timeStringToMinutes('invalid')).toThrow();
    expect(() => timeStringToMinutes('')).toThrow();
  });

  it('60.9 validateDaySlots rejects overlapping slots within the same day', () => {
    const res = validateDaySlots('Monday', [
      { start: '09:00', end: '11:00' },
      { start: '10:30', end: '12:00' }, // Overlap with 09:00-11:00
    ]);
    expect(res.isValid).toBe(false);
    expect(res.error).toContain('Overlapping slots detected');
  });

  it('60.10 validateWeeklySchedule validates valid weekly schedules across multiple days', () => {
    const res = validateWeeklySchedule([
      {
        day: 'Monday',
        slots: [
          { start: '09:00', end: '12:00' },
          { start: '14:00', end: '17:00' },
        ],
      },
      {
        day: 'Tuesday',
        slots: [{ start: '10:00', end: '16:00' }],
      },
    ]);
    expect(res.isValid).toBe(true);
  });
});
