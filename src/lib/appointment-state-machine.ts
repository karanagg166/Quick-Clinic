export type AppointmentStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'NO_SHOW'
  | 'RESCHEDULED'
  | 'EXPIRED';

export const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED', 'EXPIRED'],
  CONFIRMED: ['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED', 'EXPIRED'],
  RESCHEDULED: ['CONFIRMED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  EXPIRED: [],
};

/**
 * Checks if a transition from currentStatus to nextStatus is valid.
 * Idempotent transitions (same status to same status) are considered valid.
 */
export function isValidStatusTransition(
  currentStatus: AppointmentStatus,
  nextStatus: AppointmentStatus
): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }
  const allowed = ALLOWED_TRANSITIONS[currentStatus] || [];
  return allowed.includes(nextStatus);
}

/**
 * Validates a status transition and returns a result object.
 */
export function validateStatusTransition(
  currentStatus: AppointmentStatus,
  nextStatus: AppointmentStatus
): { valid: boolean; error?: string } {
  if (isValidStatusTransition(currentStatus, nextStatus)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Cannot transition appointment from ${currentStatus} to ${nextStatus}. Allowed transitions from ${currentStatus} are: [${(
      ALLOWED_TRANSITIONS[currentStatus] || []
    ).join(', ')}]`,
  };
}

export function isTerminalStatus(status: AppointmentStatus): boolean {
  return (ALLOWED_TRANSITIONS[status] || []).length === 0;
}

export function getAllowedTransitions(status: AppointmentStatus): AppointmentStatus[] {
  return ALLOWED_TRANSITIONS[status] || [];
}
