"use client";

interface SlotItemProps {
  slot: { slotNo: number; start: string; end: string };
  onUpdate: (field: "start" | "end", value: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

export default function SlotItem({
  slot,
  onUpdate,
  onSave,
  onDelete,
}: SlotItemProps) {
  return (
    <div className="flex items-center justify-between gap-3 p-2 border rounded">
      <div className="flex items-center gap-3">
        <div className="text-sm font-medium">Slot #{slot.slotNo}</div>

        <input
          type="time"
          value={slot.start}
          onChange={(e) => onUpdate("start", e.target.value)}
          className="border px-2 py-1 rounded"
        />

        <span className="text-sm">—</span>

        <input
          type="time"
          value={slot.end}
          onChange={(e) => onUpdate("end", e.target.value)}
          className="border px-2 py-1 rounded"
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-green-700 px-2 py-1 rounded hover:bg-green-50"
          onClick={onSave}
        >
          ✓
        </button>

        <button
          type="button"
          className="text-red-600 text-sm px-2 py-1 rounded hover:bg-red-50"
          onClick={onDelete}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
