export interface ScheduleSlot {
  slotNo?: number;
  start: string;
  end: string;
}

export interface DaySchedule {
  day: string;
  slots: ScheduleSlot[];
}

export type SlotStatus = "AVAILABLE" | "HELD" | "BOOKED" | "UNAVAILABLE" | "CANCELLED" | "ON_LEAVE";

export interface RawSlot {
  id: string;
  startTime: Date | string;
  endTime: Date | string;
  status: SlotStatus;
  appointment?: {
    id: string;
    status: string;
    patient?: {
      user?: {
        name?: string;
        email?: string;
        phoneNo?: string;
      };
    };
  } | null;
}

export interface TimelineBlock {
  type: "BUSY" | "FREE" | "BLOCKED" | "ON_LEAVE";
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  slotCount: number;
  bookedCount: number;
  title: string;
  description: string;
  status: SlotStatus;
  slots: RawSlot[];
}

export interface DayScheduleMetrics {
  totalSlots: number;
  availableCount: number;
  bookedCount: number;
  heldCount: number;
  unavailableCount: number;
  onLeaveCount: number;
  totalWorkingMinutes: number;
  freeMinutes: number;
  busyMinutes: number;
  occupancyPercentage: number;
  nextAppointmentTime?: string;
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

/**
 * Maps raw slot status to a high-level block category
 */
function getBlockType(status: SlotStatus): "BUSY" | "FREE" | "BLOCKED" | "ON_LEAVE" {
  switch (status) {
    case "BOOKED":
    case "HELD":
      return "BUSY";
    case "AVAILABLE":
      return "FREE";
    case "ON_LEAVE":
      return "ON_LEAVE";
    case "UNAVAILABLE":
    case "CANCELLED":
    default:
      return "BLOCKED";
  }
}

/**
 * Aggregates sorted slots into human-readable contiguous timeline blocks
 */
export function calculateTimelineBlocks(slots: RawSlot[]): TimelineBlock[] {
  if (!slots || slots.length === 0) return [];

  // Sort slots chronologically
  const sorted = [...slots].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const blocks: TimelineBlock[] = [];
  let currentBlockSlots: RawSlot[] = [sorted[0]];
  let currentType = getBlockType(sorted[0].status);

  for (let i = 1; i < sorted.length; i++) {
    const slot = sorted[i];
    const slotType = getBlockType(slot.status);
    const prevSlot = currentBlockSlots[currentBlockSlots.length - 1];

    const prevEnd = new Date(prevSlot.endTime).getTime();
    const currStart = new Date(slot.startTime).getTime();

    // If same type and continuous (gap <= 1 min), group together
    if (slotType === currentType && Math.abs(currStart - prevEnd) <= 60000) {
      currentBlockSlots.push(slot);
    } else {
      // Finalize current block
      blocks.push(createTimelineBlock(currentType, currentBlockSlots));
      currentBlockSlots = [slot];
      currentType = slotType;
    }
  }

  if (currentBlockSlots.length > 0) {
    blocks.push(createTimelineBlock(currentType, currentBlockSlots));
  }

  return blocks;
}

function createTimelineBlock(
  type: "BUSY" | "FREE" | "BLOCKED" | "ON_LEAVE",
  slots: RawSlot[]
): TimelineBlock {
  const firstSlot = slots[0];
  const lastSlot = slots[slots.length - 1];

  const startDate = new Date(firstSlot.startTime);
  const endDate = new Date(lastSlot.endTime);

  const startMinutes = startDate.getUTCHours() * 60 + startDate.getUTCMinutes();
  const endMinutes = endDate.getUTCHours() * 60 + endDate.getUTCMinutes();
  const durationMinutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));

  const bookedCount = slots.filter((s) => s.status === "BOOKED" || s.status === "HELD").length;

  let title = "";
  let description = "";

  switch (type) {
    case "BUSY":
      title = `Busy (${bookedCount} ${bookedCount === 1 ? "Appointment" : "Appointments"})`;
      description = `Scheduled patient consultations during this block.`;
      break;
    case "FREE":
      title = `Available (${slots.length} open ${slots.length === 1 ? "slot" : "slots"})`;
      description = `Open for bookings and patient consultations.`;
      break;
    case "ON_LEAVE":
      title = `On Leave`;
      description = `Doctor is scheduled on approved leave.`;
      break;
    case "BLOCKED":
      title = `Break / Unavailable`;
      description = `Doctor is offline or time block is reserved.`;
      break;
  }

  return {
    type,
    startTime: startDate.toISOString(),
    endTime: endDate.toISOString(),
    startMinutes,
    endMinutes,
    durationMinutes,
    slotCount: slots.length,
    bookedCount,
    title,
    description,
    status: firstSlot.status,
    slots,
  };
}

/**
 * Calculates summary metrics for a list of daily slots
 */
export function calculateDayMetrics(slots: RawSlot[]): DayScheduleMetrics {
  const totalSlots = slots.length;
  let availableCount = 0;
  let bookedCount = 0;
  let heldCount = 0;
  let unavailableCount = 0;
  let onLeaveCount = 0;
  let nextAppointmentTime: string | undefined;

  const now = new Date().getTime();

  for (const slot of slots) {
    if (slot.status === "AVAILABLE") availableCount++;
    else if (slot.status === "BOOKED") {
      bookedCount++;
      const startMs = new Date(slot.startTime).getTime();
      if (startMs >= now && (!nextAppointmentTime || startMs < new Date(nextAppointmentTime).getTime())) {
        nextAppointmentTime = new Date(slot.startTime).toISOString();
      }
    } else if (slot.status === "HELD") {
      heldCount++;
    } else if (slot.status === "UNAVAILABLE" || slot.status === "CANCELLED") {
      unavailableCount++;
    } else if (slot.status === "ON_LEAVE") {
      onLeaveCount++;
    }
  }

  const slotMinutes = 10; // Standard Quick-Clinic slot duration
  const totalWorkingMinutes = totalSlots * slotMinutes;
  const freeMinutes = availableCount * slotMinutes;
  const busyMinutes = (bookedCount + heldCount) * slotMinutes;
  const occupancyPercentage = totalSlots > 0 ? Math.round(((bookedCount + heldCount) / totalSlots) * 100) : 0;

  return {
    totalSlots,
    availableCount,
    bookedCount,
    heldCount,
    unavailableCount,
    onLeaveCount,
    totalWorkingMinutes,
    freeMinutes,
    busyMinutes,
    occupancyPercentage,
    nextAppointmentTime,
  };
}
