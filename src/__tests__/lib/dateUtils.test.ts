import { describe, it, expect } from 'vitest';
import {
  getUserTimezoneOffset,
  getUserTimezone,
  combineDateTimeInUserTimezone,
  formatUTCToUserTimezone,
  getTodayInUserTimezone,
  getCurrentTimeInUserTimezone,
  parseUTCDate,
  formatDateUTC,
  formatTimeUTC,
} from '@/lib/dateUtils';

describe('dateUtils', () => {
  it('getUserTimezoneOffset returns a number', () => {
    const offset = getUserTimezoneOffset();
    expect(typeof offset).toBe('number');
  });

  it('getUserTimezone returns a string or null', () => {
    const tz = getUserTimezone();
    expect(typeof tz === 'string' || tz === null).toBe(true);
  });

  it('combineDateTimeInUserTimezone creates valid date', () => {
    const date = combineDateTimeInUserTimezone('2026-05-15', '14:30');
    expect(date).toBeInstanceOf(Date);
    expect(isNaN(date.getTime())).toBe(false);
  });

  it('combineDateTimeInUserTimezone throws for invalid inputs', () => {
    expect(() => combineDateTimeInUserTimezone('', '14:30')).toThrow('Date and time are required');
    expect(() => combineDateTimeInUserTimezone('2026-05-15', '')).toThrow('Date and time are required');
    expect(() => combineDateTimeInUserTimezone('invalid-date', '99:99')).toThrow('Invalid date/time');
  });

  it('formatUTCToUserTimezone formats date and time', () => {
    const d = new Date('2026-05-15T14:30:00');
    const res = formatUTCToUserTimezone(d);
    expect(res).toHaveProperty('date');
    expect(res).toHaveProperty('time');
    expect(res.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formatUTCToUserTimezone throws for invalid date', () => {
    expect(() => formatUTCToUserTimezone(new Date('invalid'))).toThrow('Valid date object is required');
  });

  it('getTodayInUserTimezone returns YYYY-MM-DD', () => {
    const today = getTodayInUserTimezone();
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('getCurrentTimeInUserTimezone returns HH:MM', () => {
    const time = getCurrentTimeInUserTimezone();
    expect(time).toMatch(/^\d{2}:\d{2}$/);
  });

  it('parseUTCDate parses YYYY-MM-DD to UTC midnight Date', () => {
    const date = parseUTCDate('2026-06-20');
    expect(date.toISOString()).toBe('2026-06-20T00:00:00.000Z');
  });

  it('parseUTCDate throws for invalid date format', () => {
    expect(() => parseUTCDate('2026/06/20')).toThrow('Invalid date string');
    expect(() => parseUTCDate('')).toThrow('Invalid date string');
  });

  it('formatDateUTC returns YYYY-MM-DD', () => {
    const d = new Date('2026-06-20T12:00:00.000Z');
    expect(formatDateUTC(d)).toBe('2026-06-20');
  });

  it('formatTimeUTC returns HH:MM in UTC', () => {
    const d = new Date('2026-06-20T12:45:00.000Z');
    expect(formatTimeUTC(d)).toBe('12:45');
  });
});
