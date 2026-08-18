import { describe, it, expect } from 'vitest';
import {
  isValidStatusTransition,
  validateStatusTransition,
  getAllowedTransitions,
  isTerminalStatus,
} from '@/lib/appointment-state-machine';

describe('Appointment State Machine', () => {
  describe('isValidStatusTransition', () => {
    it('allows same-status transitions (idempotency)', () => {
      expect(isValidStatusTransition('PENDING', 'PENDING')).toBe(true);
      expect(isValidStatusTransition('CONFIRMED', 'CONFIRMED')).toBe(true);
      expect(isValidStatusTransition('COMPLETED', 'COMPLETED')).toBe(true);
      expect(isValidStatusTransition('CANCELLED', 'CANCELLED')).toBe(true);
    });

    it('allows valid transitions from PENDING', () => {
      expect(isValidStatusTransition('PENDING', 'CONFIRMED')).toBe(true);
      expect(isValidStatusTransition('PENDING', 'CANCELLED')).toBe(true);
      expect(isValidStatusTransition('PENDING', 'EXPIRED')).toBe(true);
    });

    it('disallows invalid direct transitions from PENDING', () => {
      expect(isValidStatusTransition('PENDING', 'COMPLETED')).toBe(false);
      expect(isValidStatusTransition('PENDING', 'NO_SHOW')).toBe(false);
      expect(isValidStatusTransition('PENDING', 'RESCHEDULED')).toBe(false);
    });

    it('allows valid transitions from CONFIRMED', () => {
      expect(isValidStatusTransition('CONFIRMED', 'COMPLETED')).toBe(true);
      expect(isValidStatusTransition('CONFIRMED', 'CANCELLED')).toBe(true);
      expect(isValidStatusTransition('CONFIRMED', 'NO_SHOW')).toBe(true);
      expect(isValidStatusTransition('CONFIRMED', 'RESCHEDULED')).toBe(true);
      expect(isValidStatusTransition('CONFIRMED', 'EXPIRED')).toBe(true);
    });

    it('disallows invalid transitions from CONFIRMED back to PENDING', () => {
      expect(isValidStatusTransition('CONFIRMED', 'PENDING')).toBe(false);
    });

    it('disallows transitions from terminal states', () => {
      expect(isValidStatusTransition('COMPLETED', 'CANCELLED')).toBe(false);
      expect(isValidStatusTransition('COMPLETED', 'CONFIRMED')).toBe(false);
      expect(isValidStatusTransition('CANCELLED', 'CONFIRMED')).toBe(false);
      expect(isValidStatusTransition('CANCELLED', 'COMPLETED')).toBe(false);
      expect(isValidStatusTransition('NO_SHOW', 'COMPLETED')).toBe(false);
      expect(isValidStatusTransition('EXPIRED', 'CONFIRMED')).toBe(false);
    });
  });

  describe('validateStatusTransition', () => {
    it('returns valid: true for legal transition', () => {
      const result = validateStatusTransition('PENDING', 'CONFIRMED');
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns valid: false and descriptive error for illegal transition', () => {
      const result = validateStatusTransition('COMPLETED', 'CANCELLED');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Cannot transition appointment from COMPLETED to CANCELLED');
    });
  });

  describe('isTerminalStatus', () => {
    it('identifies terminal statuses correctly', () => {
      expect(isTerminalStatus('COMPLETED')).toBe(true);
      expect(isTerminalStatus('CANCELLED')).toBe(true);
      expect(isTerminalStatus('NO_SHOW')).toBe(true);
      expect(isTerminalStatus('EXPIRED')).toBe(true);
      expect(isTerminalStatus('PENDING')).toBe(false);
      expect(isTerminalStatus('CONFIRMED')).toBe(false);
    });
  });

  describe('getAllowedTransitions', () => {
    it('returns empty array for terminal statuses', () => {
      expect(getAllowedTransitions('COMPLETED')).toEqual([]);
      expect(getAllowedTransitions('CANCELLED')).toEqual([]);
    });

    it('returns allowed list for active statuses', () => {
      expect(getAllowedTransitions('PENDING')).toEqual(['CONFIRMED', 'CANCELLED', 'EXPIRED']);
    });
  });
});
