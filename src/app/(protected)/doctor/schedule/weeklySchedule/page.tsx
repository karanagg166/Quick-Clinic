"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import ScheduleDaySection from "@/components/doctor/schedule/ScheduleDaySection";
import { showToast } from "@/lib/toast";

interface Slot {
  slotNo: number;
  start: string;
  end: string;
}

export default function DoctorWeeklySchedulePage() {
 
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
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
  };

  useEffect(() => {
    console.log("Fetching schedule for doctorId:", doctorId);
    fetchSchedule();
  }, [doctorId]);

  // Add empty slot
  const appendSlot = (dayIndex: number) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex].slots.push({
        slotNo: updated[dayIndex].slots.length + 1,
        start: "",
        end: "",
      });
      return updated;
    });
  };

  // Update slot
  const updateSlot = (
    dayIndex: number,
    slotIndex: number,
    field: "start" | "end",
    value: string
  ) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex].slots[slotIndex][field] = value;
      return updated;
    });
  };

  // Save slot validation
  const saveSlot = (dayIndex: number, slotIndex: number) => {
    const slot = schedule[dayIndex].slots[slotIndex];

    if (!slot.start || !slot.end || slot.start >= slot.end) {
      showToast.warning("Invalid slot time");
      return;
    }

    showToast.success("Slot saved!");
  };

  // Delete slot
  const deleteSlot = (dayIndex: number, slotIndex: number) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex].slots.splice(slotIndex, 1);
      return updated;
    });
  };

  // Submit full schedule
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!doctorId) {
      showToast.error("Doctor ID not found. Please login again.");
      return;
    }

    // Validate that at least one day has slots
    const hasSlots = schedule.some((day) => day.slots.length > 0);
    if (!hasSlots) {
      showToast.warning("Please add at least one time slot to your schedule.");
      return;
    }

    // Renumber slots for each day
    const normalizedSchedule = schedule.map((day) => ({
      ...day,
      slots: day.slots.map((slot, index) => ({
        ...slot,
        slotNo: index + 1,
      })),
    }));

    setLoading(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklySchedule: normalizedSchedule }),
      });

      if (res.ok) {
        showToast.success("Schedule saved successfully!");
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
    <div className="max-w-4xl mx-auto p-6">
      <h1 className="text-2xl font-semibold mb-4">Doctor Weekly Schedule</h1>

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
