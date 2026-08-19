"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";
import ScheduleDaySection from "@/components/doctor/schedule/ScheduleDaySection";
import { showToast } from "@/lib/toast";
import { validateDaySlots, validateWeeklySchedule } from "@/lib/scheduleUtils";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface Slot {
  slotNo: number;
  start: string;
  end: string;
}

export default function DoctorWeeklySchedulePage() {
  const router = useRouter();
  const doctorId = useUserStore((s) => s.doctorId);

  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  const [schedule, setSchedule] = useState(
    days.map((day) => ({ day, slots: [] as Slot[] }))
  );

  const [loading, setLoading] = useState(false);

  // Fetch existing schedule
  const fetchSchedule = async () => {
    if (!doctorId) return;

    try {
      const res = await fetch(`/api/doctors/${doctorId}/schedule`);
      
      if (!res.ok) {
        console.log("No existing schedule found");
        return;
      }

      const data = await res.json();

      if (!data?.weeklySchedule) return;

      // Ensure the schedule is an array format
      if (Array.isArray(data.weeklySchedule)) {
        console.log(data.weeklySchedule);
        setSchedule(data.weeklySchedule);
      } else {
        // Convert object format { Monday: [...], Tuesday: [...] } to array
        const formattedSchedule = days.map((day) => ({
          day,
          slots: (data.weeklySchedule[day] || []) as Slot[],
        }));
        setSchedule(formattedSchedule);
      }
    } catch (err) {
      console.error("Fetch error:", err);
      showToast.error("Failed to load schedule");
    }
  };

  useEffect(() => {
    fetchSchedule();
  }, [doctorId]);

  // Append empty slot
  const appendSlot = (dayIndex: number) => {
    const updated = [...schedule];
    const slots = updated[dayIndex].slots;

    const newSlotNo = slots.length > 0 ? slots[slots.length - 1].slotNo + 1 : 1;

    updated[dayIndex].slots.push({
      slotNo: newSlotNo,
      start: "09:00",
      end: "17:00",
    });

    setSchedule(updated);
  };

  // Update slot value
  const updateSlot = (
    dayIndex: number,
    slotIndex: number,
    field: "start" | "end",
    value: string
  ) => {
    const updated = [...schedule];
    updated[dayIndex].slots[slotIndex][field] = value;
    setSchedule(updated);
  };

  // Save single slot locally
  const saveSlot = (dayIndex: number, slotIndex: number) => {
    const slot = schedule[dayIndex].slots[slotIndex];

    if (!slot.start || !slot.end) {
      showToast.warning("Start and End time required!");
      return;
    }

    if (slot.start >= slot.end) {
      showToast.warning("End time must be after start time!");
      return;
    }

    showToast.success("Slot updated locally");
  };

  // Delete slot
  const deleteSlot = (dayIndex: number, slotIndex: number) => {
    const updated = [...schedule];
    updated[dayIndex].slots.splice(slotIndex, 1);
    setSchedule(updated);
  };

  // Handle submit to save the whole weekly schedule
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!doctorId) {
      showToast.error("Doctor ID not found");
      return;
    }

    // Normalize schedule
    const normalizedSchedule = schedule.map((d) => ({
      day: d.day,
      slots: d.slots.map((s, idx) => ({
        slotNo: s.slotNo || idx + 1,
        start: s.start.length === 5 ? s.start : s.start.substring(0, 5),
        end: s.end.length === 5 ? s.end : s.end.substring(0, 5),
      })),
    }));

    // Validate each day's slots
    for (const d of normalizedSchedule) {
      const dayValidation = validateDaySlots(d.day, d.slots);
      if (!dayValidation.isValid) {
        showToast.warning(`${d.day}: ${dayValidation.error}`);
        return;
      }
    }

    // Validate no overlapping slots across all days
    const scheduleValidation = validateWeeklySchedule(normalizedSchedule);
    if (!scheduleValidation.isValid) {
      showToast.warning(scheduleValidation.error || "Schedule validation failed");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklySchedule: normalizedSchedule }),
      });

      if (res.ok) {
        showToast.success("Schedule saved successfully!");
        router.push("/doctor/schedule");
      } else {
        const error = await res.json();
        showToast.error(`Failed to save: ${error.error || "Unknown error"}`);
      }
    } catch (err) {
      console.error("Save error:", err);
      showToast.error("Failed to save schedule. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/doctor/schedule">
            <ArrowLeft className="w-4 h-4" /> Back to Schedule
          </Link>
        </Button>
      </div>

      <div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Doctor Weekly Schedule</h1>
        <p className="text-sm text-muted-foreground mt-1">Configure your recurring working days and consultation time blocks.</p>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {schedule.map((d, dayIndex) => (
            <ScheduleDaySection
              key={d.day}
              day={d.day}
              dayIndex={dayIndex}
              slots={d.slots}
              appendSlot={() => appendSlot(dayIndex)}
              deleteSlot={(slotIndex) => deleteSlot(dayIndex, slotIndex)}
              saveSlot={(slotIndex) => saveSlot(dayIndex, slotIndex)}
              updateSlot={(slotIndex, field, value) =>
                updateSlot(dayIndex, slotIndex, field, value)
              }
            />
          ))}
        </div>

        <button
          type="submit"
          className="mt-6 bg-green-600 text-white px-4 py-2 rounded"
          disabled={loading}
        >
          {loading ? "Saving..." : "Save schedule"}
        </button>
      </form>
    </div>
  );
}
