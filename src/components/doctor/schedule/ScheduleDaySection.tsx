"use client";

import SlotItem from "./SlotItem";

interface Slot {
  slotNo: number;
  start: string;
  end: string;
}

interface Props {
  day: string;
  dayIndex: number;
  slots: Slot[];
  appendSlot: () => void;
  deleteSlot: (slotIndex: number) => void;
  updateSlot: (slotIndex: number, field: "start" | "end", value: string) => void;
  saveSlot: (slotIndex: number) => void;
}

export default function ScheduleDaySection({
  day,
  dayIndex,
  slots,
  appendSlot,
  deleteSlot,
  updateSlot,
  saveSlot,
}: Props) {
  return (
    <section className="border rounded p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-medium">{day}</h2>
        <div className="text-sm text-gray-500">
          {slots.length} slot{slots.length !== 1 ? "s" : ""}
        </div>
      </div>

      <div className="space-y-2 mb-4">
        {slots.length === 0 && (
          <div className="text-sm text-gray-500">No slots for this day yet.</div>
        )}

        {slots.map((slot, slotIndex) => (
          <SlotItem
            key={slotIndex}
            slot={slot}
            onUpdate={(field, value) => updateSlot(slotIndex, field, value)}
            onSave={() => saveSlot(slotIndex)}
            onDelete={() => deleteSlot(slotIndex)}
          />
        ))}
      </div>

      <button
        type="button"
        className="w-full sm:w-auto bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700"
        onClick={appendSlot}
      >
        + Add Slot
      </button>
    </section>
  );
}
