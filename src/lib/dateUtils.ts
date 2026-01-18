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
 * Example: User in India (IST=UTC+5:30) inputs "2026-01-20" and "14:00"
 * This converts 2:00 PM IST → 8:30 AM UTC
 * 
 * @param dateStr - Date string in YYYY-MM-DD format (user's local date)
 * @param timeStr - Time string in HH:MM format (user's local time)
 * @returns Date object in UTC
 */
export function combineDateTimeInUserTimezone(dateStr: string, timeStr: string): Date {
  if (!dateStr || !timeStr) {
    throw new Error('Date and time are required');
  }

  // Create a date object interpreting the input as LOCAL time
  // new Date("2026-01-20T14:00") creates a date in browser's local timezone
  const localDate = new Date(`${dateStr}T${timeStr}:00`);
  if (isNaN(localDate.getTime())) {
    throw new Error(`Invalid date/time combination: ${dateStr} ${timeStr}`);
  }

  // Convert local time to UTC by accounting for timezone offset
  // getTimezoneOffset() returns offset in minutes (negative for east of UTC)
  // E.g., for IST (UTC+5:30), it returns -330
  const utcDate = new Date(
    localDate.getTime() - getUserTimezoneOffset() * 60 * 1000
  );

  return utcDate;
}

/**
 * Format a UTC Date object back to user's local timezone
 * 
 * Example: Server sends "2026-01-20T08:30:00.000Z" (UTC)
 * User in India sees "2026-01-20" and "14:00" (IST)
 * 
 * @param utcDate - Date object in UTC
 * @returns Object with { date: "YYYY-MM-DD", time: "HH:MM" } in user's timezone
 */
export function formatUTCToUserTimezone(utcDate: Date): { date: string; time: string } {
  // Convert UTC to local time
  const localDate = new Date(
    utcDate.getTime() + getUserTimezoneOffset() * 60 * 1000
  );

  const date = localDate.toISOString().split('T')[0]; // "YYYY-MM-DD"
  const time = localDate.toISOString().slice(11, 16); // "HH:MM"

  return { date, time };
}

/**
 * Get today's date in user's local timezone (YYYY-MM-DD)
 * @returns Date string in YYYY-MM-DD format
 */
export function getTodayInUserTimezone(): string {
  const now = new Date();
  const localDate = new Date(
    now.getTime() + getUserTimezoneOffset() * 60 * 1000
  );
  return localDate.toISOString().split('T')[0];
}

/**
 * Get current time in user's local timezone (HH:MM)
 * @returns Time string in HH:MM format
 */
export function getCurrentTimeInUserTimezone(): string {
  const now = new Date();
  const localDate = new Date(
    now.getTime() + getUserTimezoneOffset() * 60 * 1000
  );
  return localDate.toISOString().slice(11, 16);
}

/**
 * Parse a date string as UTC midnight (for server-side use)
 * @param dateStr - Date string in YYYY-MM-DD format
 * @returns Date object set to UTC midnight
 */
export function parseUTCDate(dateStr: string): Date {
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
  return date.toISOString().split('T')[0];
}

/**
 * Format a UTC Date object to HH:MM
 * @param date - Date object in UTC
 * @returns Time string in HH:MM format
 */
export function formatTimeUTC(date: Date): string {
  return date.toISOString().slice(11, 16);
}
