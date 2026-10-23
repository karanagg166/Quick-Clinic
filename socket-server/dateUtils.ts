export const DEFAULT_CLINIC_TIMEZONE = 'Asia/Kolkata';

export const CANONICAL_TIMEZONE_EPOCH = new Date('2026-10-22T23:45:00.000Z');

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
  } catch {}
  return timeZone === 'Asia/Kolkata' ? 'IST' : timeZone;
}

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
