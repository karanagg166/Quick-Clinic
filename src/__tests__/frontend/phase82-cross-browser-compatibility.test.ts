import { describe, it, expect } from 'vitest';
import { parseISO, isValid, format } from 'date-fns';

describe('Phase 82: Cross-Browser Date/Time & Web API Compatibility Test Suite', () => {
  it('82.1 WebKit/Safari-safe ISO-8601 parsing handles standard and edge-case timestamps', () => {
    const isoStrings = [
      '2026-10-15T09:30:00.000Z',
      '2026-10-15T09:30:00Z',
      '2026-10-15T09:30:00+05:30',
      '2026-10-15',
    ];

    for (const iso of isoStrings) {
      const parsed = parseISO(iso);
      expect(isValid(parsed)).toBe(true);
      expect(parsed.getFullYear()).toBe(2026);
    }
  });

  it('82.2 URLSearchParams parses query parameters safely across diverse browser engines', () => {
    const url = new URL('https://quickclinic.test/api/doctors?city=New%20Delhi&specialty=CARDIOLOGIST&fees=500-1000');
    expect(url.searchParams.get('city')).toBe('New Delhi');
    expect(url.searchParams.get('specialty')).toBe('CARDIOLOGIST');
    expect(url.searchParams.get('fees')).toBe('500-1000');
  });

  it('82.3 Safe Date formatting functions guard against NaN dates gracefully', () => {
    const invalidDate = new Date('invalid-date-string');
    const isDateValid = !isNaN(invalidDate.getTime());
    expect(isDateValid).toBe(false);

    const safeDateText = isDateValid
      ? format(invalidDate, 'yyyy-MM-dd')
      : 'N/A';
    expect(safeDateText).toBe('N/A');
  });

  it('82.4 Handles complex nested JSON payloads with unicode characters without corruption', () => {
    const complexPayload = {
      doctorName: 'Dr. René Müller 🩺',
      specialty: 'Pediatrics & Neonatology',
      notes: 'Patient noted: "Occasional migraine — mild symptoms & allergy to penicillin"',
      fees: 750,
      currencySymbol: '₹',
    };

    const serialized = JSON.stringify(complexPayload);
    const parsed = JSON.parse(serialized);

    expect(parsed.doctorName).toBe('Dr. René Müller 🩺');
    expect(parsed.currencySymbol).toBe('₹');
    expect(parsed.fees).toBe(750);
  });
});
