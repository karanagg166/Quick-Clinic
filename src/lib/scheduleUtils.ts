export interface ScheduleSlot {
  slotNo?: number;
  start: string;
  end: string;
}

export interface DaySchedule {
  day: string;
  slots: ScheduleSlot[];
}

/**
 * Converts "HH:mm" time string into total minutes since midnight (0 - 1439).
 */
export function timeStringToMinutes(timeStr: string): number {
  if (!timeStr || typeof timeStr !== "string") {
    throw new Error(`Invalid time string: ${timeStr}`);
  }
  const parts = timeStr.trim().split(":");
  if (parts.length !== 2) {
    throw new Error(`Invalid time format (expected HH:mm): ${timeStr}`);
  }
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error(`Invalid time values: ${timeStr}`);
  }
  return hours * 60 + minutes;
}

export interface SlotValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates a list of slots for a single day:
 * 1. Checks valid HH:mm format.
 * 2. Checks start < end (positive duration).
 * 3. Checks that no two slots overlap (e.g. 02:00-15:00 and 03:00-04:00).
 */
export function validateDaySlots(day: string, slots: ScheduleSlot[]): SlotValidationResult {
  if (!slots || slots.length === 0) {
    return { isValid: true };
  }

  // Validate individual slot formats and start < end
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.start || !slot.end) {
      return {
        isValid: false,
        error: `Slot #${slot.slotNo || i + 1} on ${day} is missing start or end time.`,
      };
    }

    let startMin: number;
    let endMin: number;
    try {
      startMin = timeStringToMinutes(slot.start);
      endMin = timeStringToMinutes(slot.end);
    } catch {
      return {
        isValid: false,
        error: `Invalid time format in slot #${slot.slotNo || i + 1} on ${day} (${slot.start} - ${slot.end}).`,
      };
    }

    if (startMin >= endMin) {
      return {
        isValid: false,
        error: `Invalid time in slot #${slot.slotNo || i + 1} on ${day}: start time (${slot.start}) must be before end time (${slot.end}).`,
      };
    }
  }

  // Check pairwise overlaps
  for (let i = 0; i < slots.length; i++) {
    const slotA = slots[i];
    const startA = timeStringToMinutes(slotA.start);
    const endA = timeStringToMinutes(slotA.end);

    for (let j = i + 1; j < slots.length; j++) {
      const slotB = slots[j];
      const startB = timeStringToMinutes(slotB.start);
      const endB = timeStringToMinutes(slotB.end);

      // Overlap condition: startA < endB && startB < endA
      if (startA < endB && startB < endA) {
        return {
          isValid: false,
          error: `Overlapping slots detected on ${day}: [${slotA.start} - ${slotA.end}] overlaps with [${slotB.start} - ${slotB.end}].`,
        };
      }
    }
  }

  return { isValid: true };
}

/**
 * Validates full weekly schedule structure and overlap across all days.
 */
export function validateWeeklySchedule(weeklySchedule: DaySchedule[]): SlotValidationResult {
  if (!Array.isArray(weeklySchedule)) {
    return {
      isValid: false,
      error: "weeklySchedule must be an array.",
    };
  }

  for (const daySchedule of weeklySchedule) {
    if (!daySchedule.day) {
      return {
        isValid: false,
        error: "Each day schedule must specify a day name.",
      };
    }

    const dayValidation = validateDaySlots(daySchedule.day, daySchedule.slots || []);
    if (!dayValidation.isValid) {
      return dayValidation;
    }
  }

  return { isValid: true };
}
