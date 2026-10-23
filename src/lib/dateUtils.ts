/**
 * Canonical Timezone & Date Contract for Quick-Clinic
 * 
 * CORE CONTRACT:
 * 1. Database stores all actual appointment start/end instants in UTC (DateTime).
 * 2. Calendar dates are stored separately as UTC midnight markers (@db.Date).
 * 3. Doctor weekly schedules are defined in the clinic's / doctor's authoritative IANA timezone
 *    (default: 'Asia/Kolkata').
 * 4. Slot generation interprets local doctor schedule wall times within the doctor's timezone
 *    and converts them to exact UTC instants before persisting to PostgreSQL.
 *    Example:
 *      Doctor in Asia/Kolkata scheduled for 10:00 AM.
 *      Stored UTC instant: 2026-10-26T04:30:00.000Z.
 * 5. Display explicitly converts UTC instants to the doctor's authoritative clinic timezone
 *    (as primary time, e.g. "10:00 AM IST"), and optionally includes the patient-local
 *    equivalent when the patient's browser timezone differs.
 * 6. Legacy slots generated with naive setUTCHours() are safely detected and preserved
 *    so existing booked appointments never shift by 5h30m.
 */

export const DEFAULT_CLINIC_TIMEZONE = 'Asia/Kolkata';

// Canonical cutoff epoch: slots created after this timestamp are guaranteed canonical.
export const CANONICAL_TIMEZONE_EPOCH = new Date('2026-10-22T23:45:00.000Z');

/**
 * Returns user's browser timezone offset in minutes.
 */
export function getUserTimezoneOffset(): number {
  return new Date().getTimezoneOffset();
}

/**
 * Returns user's browser timezone identifier (e.g. 'Asia/Kolkata', 'America/New_York').
 */
export function getUserTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * Returns the short timezone abbreviation for a given date in an IANA timezone
 * (e.g. "IST", "EDT", "EST", "BST", "GMT", "UTC").
 */
export function getTimezoneAbbreviation(date: Date, timeZone: string = DEFAULT_CLINIC_TIMEZONE): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'short',
    });
    const parts = formatter.formatToParts(date);
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    if (tzPart && tzPart.value) {
      if (tzPart.value === 'GMT+5:30' || tzPart.value === 'UTC+5:30' || timeZone === 'Asia/Kolkata') {
        return 'IST';
      }
      return tzPart.value;
    }
  } catch {
    // fallback
  }
  return timeZone === 'Asia/Kolkata' ? 'IST' : timeZone;
}

/**
 * Converts a local calendar date (YYYY-MM-DD) and local time (HH:mm) in a specified
 * IANA timezone (e.g. 'Asia/Kolkata') into an exact UTC Date object.
 *
 * Handles standard offsets and DST transitions without naive fixed arithmetic.
 */
export function localDateAndTimeToUtc(
  dateStr: string,
  timeStr: string,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): Date {
  if (!dateStr || !timeStr) {
    throw new Error('Date and time are required');
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr) || !/^\d{2}:\d{2}$/.test(timeStr)) {
    throw new Error(`Invalid date/time format: ${dateStr} ${timeStr}`);
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time values: ${timeStr}`);
  }

  // Initial estimate in UTC
  let guess = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0));

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  });

  // Iteratively converge to target local time (handles DST steps & arbitrary offsets)
  for (let i = 0; i < 4; i++) {
    const parts = dtf.formatToParts(guess);
    const p: Record<string, number> = {};
    for (const part of parts) {
      if (part.type !== 'literal') {
        p[part.type] = parseInt(part.value, 10);
      }
    }
    if (p.hour === 24) p.hour = 0;

    const targetUtcMs = Date.UTC(year, month - 1, day, hours, minutes, 0);
    const actualUtcMs = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second || 0);
    const diff = targetUtcMs - actualUtcMs;

    if (diff === 0) break;
    guess = new Date(guess.getTime() + diff);
  }

  return guess;
}

/**
 * Legacy compatibility wrapper: converts date & time entered in user's detected timezone
 * to a UTC Date object.
 */
export function combineDateTimeInUserTimezone(dateStr: string, timeStr: string): Date {
  const userTz = getUserTimezone() || DEFAULT_CLINIC_TIMEZONE;
  return localDateAndTimeToUtc(dateStr, timeStr, userTz);
}

/**
 * Converts a UTC Date to local date and time in a specified IANA timezone.
 */
export function utcToLocalDateAndTime(
  utcDate: Date,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE
): { date: string; time: string; timeZoneName: string } {
  if (!utcDate || isNaN(utcDate.getTime())) {
    throw new Error('Valid date object is required');
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = dtf.formatToParts(utcDate);
  const p: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      p[part.type] = part.value;
    }
  }

  const hourNum = parseInt(p.hour, 10);
  const normalizedHour = hourNum === 24 ? '00' : p.hour;

  return {
    date: `${p.year}-${p.month}-${p.day}`,
    time: `${normalizedHour}:${p.minute}`,
    timeZoneName: getTimezoneAbbreviation(utcDate, timeZone),
  };
}

/**
 * Legacy compatibility wrapper: converts a UTC Date to user's local timezone components.
 */
export function formatUTCToUserTimezone(utcDate: Date): { date: string; time: string } {
  const userTz = getUserTimezone() || DEFAULT_CLINIC_TIMEZONE;
  const { date, time } = utcToLocalDateAndTime(utcDate, userTz);
  return { date, time };
}

/**
 * Returns today's calendar date in user's timezone (YYYY-MM-DD).
 */
export function getTodayInUserTimezone(timeZone?: string): string {
  const tz = timeZone || getUserTimezone() || DEFAULT_CLINIC_TIMEZONE;
  const { date } = utcToLocalDateAndTime(new Date(), tz);
  return date;
}

/**
 * Returns current time in user's timezone (HH:mm).
 */
export function getCurrentTimeInUserTimezone(timeZone?: string): string {
  const tz = timeZone || getUserTimezone() || DEFAULT_CLINIC_TIMEZONE;
  const { time } = utcToLocalDateAndTime(new Date(), tz);
  return time;
}

/**
 * Checks if a slot was generated under the legacy setUTCHours() implementation
 * without canonical offset shifting.
 */
export function isLegacySlot(slot?: {
  startTime?: Date | string | null;
  createdAt?: Date | string | null;
  isLegacy?: boolean | null;
} | null): boolean {
  if (!slot) return false;
  if (typeof slot.isLegacy === 'boolean') return slot.isLegacy;
  if (!slot.createdAt) return false;

  const created = new Date(slot.createdAt);
  return !isNaN(created.getTime()) && created < CANONICAL_TIMEZONE_EPOCH;
}

/**
 * Formats appointment time in an authoritative timezone with optional timezone label.
 * E.g., "10:00 AM IST" or "10:00 AM".
 */
export function formatAppointmentTime(
  dateInput: Date | string,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE,
  options?: { includeTimezone?: boolean; isLegacy?: boolean }
): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';

  const effectiveTz = options?.isLegacy ? 'UTC' : timeZone;

  const timeStr = new Intl.DateTimeFormat('en-US', {
    timeZone: effectiveTz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);

  if (options?.includeTimezone === false) {
    return timeStr;
  }

  const tzAbbr = options?.isLegacy ? 'UTC' : getTimezoneAbbreviation(d, effectiveTz);
  return `${timeStr} ${tzAbbr}`;
}

/**
 * Formats appointment date in an authoritative timezone.
 * E.g., "Mon, Oct 26, 2026".
 */
export function formatAppointmentDate(
  dateInput: Date | string,
  timeZone: string = DEFAULT_CLINIC_TIMEZONE,
  options?: { isLegacy?: boolean }
): string {
  if (!dateInput) return '';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return '';

  const effectiveTz = options?.isLegacy ? 'UTC' : timeZone;

  return new Intl.DateTimeFormat('en-US', {
    timeZone: effectiveTz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
}

/**
 * Formats combined appointment date and time for user-facing notifications, cards, and receipts.
 * E.g.: "Mon, Oct 26, 2026 at 10:00 AM IST"
 * If patient's browser timezone differs: "Mon, Oct 26, 2026 at 10:00 AM IST (12:30 AM EDT)"
 */
export function formatAppointmentDateTime(
  dateInput: Date | string,
  options?: {
    timeZone?: string;
    patientTimeZone?: string;
    includePatientEquiv?: boolean;
    isLegacy?: boolean;
  }
): string {
  if (!dateInput) return 'N/A';
  const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(d.getTime())) return 'N/A';

  const clinicTz = options?.timeZone || DEFAULT_CLINIC_TIMEZONE;
  const isLegacy = options?.isLegacy ?? false;

  const dateStr = formatAppointmentDate(d, clinicTz, { isLegacy });
  const timeStr = formatAppointmentTime(d, clinicTz, { includeTimezone: true, isLegacy });

  let result = `${dateStr} at ${timeStr}`;

  if (
    options?.includePatientEquiv &&
    options?.patientTimeZone &&
    options.patientTimeZone !== clinicTz &&
    !isLegacy
  ) {
    try {
      const patientTime = formatAppointmentTime(d, options.patientTimeZone, { includeTimezone: true });
      result += ` (${patientTime})`;
    } catch {
      // Ignore invalid patient timezone
    }
  }

  return result;
}

/**
 * Formats slot time for booking slot buttons with primary clinic time and optional patient local time.
 */
export function formatSlotButtonLabel(
  dateInput: Date | string,
  options?: {
    doctorTimeZone?: string;
    patientTimeZone?: string;
    isLegacy?: boolean;
  }
): { primaryLabel: string; patientLabel?: string } {
  const doctorTz = options?.doctorTimeZone || DEFAULT_CLINIC_TIMEZONE;
  const patientTz = options?.patientTimeZone || getUserTimezone();
  const isLegacy = options?.isLegacy ?? false;

  const primaryLabel = formatAppointmentTime(dateInput, doctorTz, { includeTimezone: false, isLegacy });

  let patientLabel: string | undefined;
  if (patientTz && patientTz !== doctorTz && !isLegacy) {
    try {
      const equiv = formatAppointmentTime(dateInput, patientTz, { includeTimezone: true });
      patientLabel = equiv;
    } catch {
      // Ignore invalid timezone
    }
  }

  return { primaryLabel, patientLabel };
}

/**
 * Parse a date string as UTC midnight (for server-side DB querying)
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
 */
export function formatDateUTC(date: Date): string {
  if (!date || isNaN(date.getTime())) {
    throw new Error('Valid date is required');
  }
  return date.toISOString().split('T')[0];
}

/**
 * Format a UTC Date object to HH:MM
 */
export function formatTimeUTC(date: Date): string {
  if (!date || isNaN(date.getTime())) {
    throw new Error('Valid date is required');
  }
  return date.toISOString().slice(11, 16);
}
