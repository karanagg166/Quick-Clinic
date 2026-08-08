/**
 * Timezone-Aware Date Utilities
 * 
 * User inputs are in their LOCAL timezone.
 * Server stores everything in UTC.
 * Display converts UTC back to user's LOCAL timezone.
 */

/**
 * Get user's timezone offset in minutes
 * @returns Timezone offset in minutes (e.g., -330 for IST = UTC+5:30)
 */
export function getUserTimezoneOffset(): number {
  return new Date().getTimezoneOffset();
}

/**
 * Get user's timezone identifier (e.g., 'Asia/Kolkata')
 * Uses browser's Intl API
 * @returns Timezone string or null if not available
 */
export function getUserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Convert user's local date+time input to UTC Date object
 * 
 * @param dateStr - Date string in YYYY-MM-DD format (user's local date)
 * @param timeStr - Time string in HH:MM format (user's local time)
 * @returns Date object in UTC
 */
export function combineDateTimeInUserTimezone(dateStr: string, timeStr: string): Date {
  if (!dateStr || !timeStr) {
    throw new Error('Date and time are required');
  }

  // Parse local date & time safely
  const localDate = new Date(`${dateStr}T${timeStr}:00`);
  if (isNaN(localDate.getTime())) {
    throw new Error(`Invalid date/time combination: ${dateStr} ${timeStr}`);
  }

  return localDate;
}

/**
 * Format a UTC Date object back to user's local timezone
 * 
 * @param utcDate - Date object
 * @returns Object with { date: "YYYY-MM-DD", time: "HH:MM" } in user's timezone
 */
export function formatUTCToUserTimezone(utcDate: Date): { date: string; time: string } {
  if (!utcDate || isNaN(utcDate.getTime())) {
    throw new Error('Valid date object is required');
  }

  const year = utcDate.getFullYear();
  const month = String(utcDate.getMonth() + 1).padStart(2, '0');
  const day = String(utcDate.getDate()).padStart(2, '0');
  const hours = String(utcDate.getHours()).padStart(2, '0');
  const minutes = String(utcDate.getMinutes()).padStart(2, '0');

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
}

/**
 * Get today's date in user's local timezone (YYYY-MM-DD)
 * @returns Date string in YYYY-MM-DD format
 */
export function getTodayInUserTimezone(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get current time in user's local timezone (HH:MM)
 * @returns Time string in HH:MM format
 */
export function getCurrentTimeInUserTimezone(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Parse a date string as UTC midnight (for server-side use)
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object set to UTC midnight
 */
export function parseUTCDate(dateStr: string): Date {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  const date = new Date(`${dateStr}T00:00:00.000Z`);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${dateStr}`);
  }
  return date;
}

/**
 * Format a UTC Date object to YYYY-MM-DD
 * @param date - Date object in UTC
 * @returns Date string in YYYY-MM-DD format
 */
export function formatDateUTC(date: Date): string {
  if (!date || isNaN(date.getTime())) {
    throw new Error('Valid date is required');
  }
  return date.toISOString().split('T')[0];
}

/**
 * Format a UTC Date object to HH:MM
 * @param date - Date object in UTC
 * @returns Time string in HH:MM format
 */
export function formatTimeUTC(date: Date): string {
  if (!date || isNaN(date.getTime())) {
    throw new Error('Valid date is required');
  }
  return date.toISOString().slice(11, 16);
}
