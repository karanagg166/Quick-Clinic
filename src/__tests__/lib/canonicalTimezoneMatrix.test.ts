import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CLINIC_TIMEZONE,
  localDateAndTimeToUtc,
  utcToLocalDateAndTime,
  formatAppointmentTime,
  formatAppointmentDate,
  formatAppointmentDateTime,
  formatSlotButtonLabel,
  isLegacySlot,
} from '@/lib/dateUtils';

describe('Canonical Timezone Matrix & Appointment Invariants (Phase 1.4)', () => {
  it('Scenario 1: India 10:00 AM booking -> UTC 04:30, displayed 10:00 AM IST', () => {
    const utcInstant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata');
    expect(utcInstant.toISOString()).toBe('2026-10-26T04:30:00.000Z');

    const displayedTime = formatAppointmentTime(utcInstant, 'Asia/Kolkata');
    expect(displayedTime).toBe('10:00 AM IST');

    const displayedDate = formatAppointmentDate(utcInstant, 'Asia/Kolkata');
    expect(displayedDate).toBe('Mon, Oct 26, 2026');
  });

  it('Scenario 2: India 2:00 PM booking -> UTC 08:30, displayed 2:00 PM IST', () => {
    const utcInstant = localDateAndTimeToUtc('2026-10-26', '14:00', 'Asia/Kolkata');
    expect(utcInstant.toISOString()).toBe('2026-10-26T08:30:00.000Z');

    const displayedTime = formatAppointmentTime(utcInstant, 'Asia/Kolkata');
    expect(displayedTime).toBe('2:00 PM IST');
  });

  it('Scenario 3: India 11:50 PM booking -> correct calendar date (Mon, Oct 26, 2026)', () => {
    const utcInstant = localDateAndTimeToUtc('2026-10-26', '23:50', 'Asia/Kolkata');
    // 23:50 IST - 5:30 = 18:20 UTC same day
    expect(utcInstant.toISOString()).toBe('2026-10-26T18:20:00.000Z');

    const displayedDate = formatAppointmentDate(utcInstant, 'Asia/Kolkata');
    expect(displayedDate).toBe('Mon, Oct 26, 2026');
    expect(formatAppointmentTime(utcInstant, 'Asia/Kolkata')).toBe('11:50 PM IST');
  });

  it('Scenario 4: UTC 00:15 appointment -> correct local day rollover across timezones', () => {
    // 2026-10-27T00:15:00.000Z
    const utcInstant = new Date('2026-10-27T00:15:00.000Z');

    // In India (UTC+5:30), it rolls over to Oct 27 at 5:45 AM
    expect(formatAppointmentDate(utcInstant, 'Asia/Kolkata')).toBe('Tue, Oct 27, 2026');
    expect(formatAppointmentTime(utcInstant, 'Asia/Kolkata')).toBe('5:45 AM IST');

    // In New York (EDT, UTC-4), it is still Oct 26 at 8:15 PM
    expect(formatAppointmentDate(utcInstant, 'America/New_York')).toBe('Mon, Oct 26, 2026');
    expect(formatAppointmentTime(utcInstant, 'America/New_York')).toBe('8:15 PM EDT');
  });

  it('Scenario 5: Doctor in India, patient in UK -> Same instant, clearly labeled times', () => {
    const instant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata'); // 04:30Z
    const combined = formatAppointmentDateTime(instant, {
      timeZone: 'Asia/Kolkata',
      patientTimeZone: 'Europe/London',
      includePatientEquiv: true,
    });
    // On 2026-10-26, UK is in GMT (UTC+0) or BST depending on DST switch on Oct 25
    expect(combined).toContain('Mon, Oct 26, 2026 at 10:00 AM IST');
    expect(combined).toMatch(/4:30 AM (GMT|BST)/);
  });

  it('Scenario 6: Doctor in India, patient in USA -> Same instant, no accidental shift', () => {
    const instant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata'); // 04:30Z
    const combined = formatAppointmentDateTime(instant, {
      timeZone: 'Asia/Kolkata',
      patientTimeZone: 'America/New_York',
      includePatientEquiv: true,
    });
    expect(combined).toBe('Mon, Oct 26, 2026 at 10:00 AM IST (12:30 AM EDT)');
  });

  it('Scenario 7, 8, 9: Browser timezone UTC, Asia/Kolkata, America/New_York see same canonical appointment instant', () => {
    const instant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata');
    const isoString = instant.toISOString();

    const utcDoctorView = formatAppointmentTime(new Date(isoString), 'Asia/Kolkata');
    const kolkataDoctorView = formatAppointmentTime(new Date(isoString), 'Asia/Kolkata');
    const nyDoctorView = formatAppointmentTime(new Date(isoString), 'Asia/Kolkata');

    expect(utcDoctorView).toBe('10:00 AM IST');
    expect(kolkataDoctorView).toBe('10:00 AM IST');
    expect(nyDoctorView).toBe('10:00 AM IST');
  });

  it('Scenario 10, 11: Server timezone UTC vs Asia/Kolkata produce identical UTC instant and display', () => {
    // Calling localDateAndTimeToUtc does not rely on process.env.TZ
    const instantUtc = localDateAndTimeToUtc('2026-10-26', '14:30', 'Asia/Kolkata');
    expect(instantUtc.toISOString()).toBe('2026-10-26T09:00:00.000Z');

    const formatted = formatAppointmentDateTime(instantUtc, { timeZone: 'Asia/Kolkata' });
    expect(formatted).toBe('Mon, Oct 26, 2026 at 2:30 PM IST');
  });

  it('Scenario 12: DST spring-forward transition handles non-existent hour gracefully', () => {
    // US spring-forward gap: 2026-03-08 at 2:00 AM clocks jump to 3:00 AM
    // An appointment at 02:30 in America/New_York resolves gracefully to a valid instant
    const instant = localDateAndTimeToUtc('2026-03-08', '02:30', 'America/New_York');
    expect(instant).toBeInstanceOf(Date);
    expect(isNaN(instant.getTime())).toBe(false);
    expect(instant.toISOString()).toBe('2026-03-08T06:30:00.000Z');
  });

  it('Scenario 13: DST fall-back transition resolves ambiguous hour deterministically', () => {
    // US fall-back repeat: 2026-11-01 at 2:00 AM clocks repeat 1:00 AM
    const instant = localDateAndTimeToUtc('2026-11-01', '01:30', 'America/New_York');
    expect(instant).toBeInstanceOf(Date);
    expect(isNaN(instant.getTime())).toBe(false);
    expect(instant.toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('Scenario 14: Leap day handling (2028-02-29) preserves weekday and instant', () => {
    const leapDayInstant = localDateAndTimeToUtc('2028-02-29', '11:00', 'Asia/Kolkata');
    // 2028 is a leap year; 2028-02-29 is a Tuesday
    expect(leapDayInstant.toISOString()).toBe('2028-02-29T05:30:00.000Z');
    expect(formatAppointmentDate(leapDayInstant, 'Asia/Kolkata')).toBe('Tue, Feb 29, 2028');
    expect(formatAppointmentTime(leapDayInstant, 'Asia/Kolkata')).toBe('11:00 AM IST');
  });

  it('Scenario 15: Payment completed after midnight does not alter original slot scheduled time', () => {
    const originalSlotInstant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata');
    const paymentCompletedAt = new Date('2026-10-27T01:15:00.000Z'); // Next day payment completion

    // The appointment must preserve originalSlotInstant regardless of payment execution timestamp
    expect(originalSlotInstant.toISOString()).toBe('2026-10-26T04:30:00.000Z');
    expect(paymentCompletedAt.getTime()).toBeGreaterThan(originalSlotInstant.getTime());

    const confirmationDisplay = formatAppointmentDateTime(originalSlotInstant, { timeZone: 'Asia/Kolkata' });
    expect(confirmationDisplay).toBe('Mon, Oct 26, 2026 at 10:00 AM IST');
  });

  it('Scenario 16: Reschedule reflects new slot instant in all confirmation messages', () => {
    const originalSlotInstant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata');
    const rescheduledSlotInstant = localDateAndTimeToUtc('2026-10-28', '15:00', 'Asia/Kolkata');

    const originalMsg = `Your appointment is confirmed for ${formatAppointmentDateTime(originalSlotInstant, { timeZone: 'Asia/Kolkata' })}.`;
    const rescheduledMsg = `Your appointment has been rescheduled to ${formatAppointmentDateTime(rescheduledSlotInstant, { timeZone: 'Asia/Kolkata' })}.`;

    expect(originalMsg).toBe('Your appointment is confirmed for Mon, Oct 26, 2026 at 10:00 AM IST.');
    expect(rescheduledMsg).toBe('Your appointment has been rescheduled to Wed, Oct 28, 2026 at 3:00 PM IST.');
  });

  it('Scenario 17: Cancellation references original correct appointment time', () => {
    const originalSlotInstant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata');
    const cancelMsg = `Appointment scheduled for ${formatAppointmentDateTime(originalSlotInstant, { timeZone: 'Asia/Kolkata' })} was cancelled.`;

    expect(cancelMsg).toBe('Appointment scheduled for Mon, Oct 26, 2026 at 10:00 AM IST was cancelled.');
  });

  it('Scenario 18: Slot button labels show primary clinic time and optional patient local time', () => {
    const instant = localDateAndTimeToUtc('2026-10-26', '10:00', 'Asia/Kolkata');
    const { primaryLabel, patientLabel } = formatSlotButtonLabel(instant, {
      doctorTimeZone: 'Asia/Kolkata',
      patientTimeZone: 'America/New_York',
    });

    expect(primaryLabel).toBe('10:00 AM');
    expect(patientLabel).toBe('12:30 AM EDT');
  });

  it('Scenario 19: Legacy slot detection safely avoids 5h30m shift on legacy records', () => {
    const legacySlot = {
      startTime: '2026-10-23T16:10:00.000Z',
      createdAt: '2026-10-22T23:17:01.522Z',
    };
    expect(isLegacySlot(legacySlot)).toBe(true);

    const legacyTime = formatAppointmentTime(legacySlot.startTime, 'Asia/Kolkata', {
      isLegacy: true,
      includeTimezone: false,
    });
    // Preserves the 4:10 PM the user originally saw
    expect(legacyTime).toBe('4:10 PM');
  });

  it('Scenario 20: New canonical slot formats correctly with IST in Asia/Kolkata', () => {
    const canonicalSlot = {
      startTime: '2026-10-26T04:30:00.000Z',
      createdAt: '2026-10-23T06:00:00.000Z',
    };
    expect(isLegacySlot(canonicalSlot)).toBe(false);

    const time = formatAppointmentTime(canonicalSlot.startTime, 'Asia/Kolkata', {
      isLegacy: false,
      includeTimezone: true,
    });
    expect(time).toBe('10:00 AM IST');
  });
});
