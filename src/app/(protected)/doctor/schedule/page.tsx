"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

type Slot = {
  id: string;
  startTime: string;
  endTime: string;
  status: "AVAILABLE" | "HELD" | "BOOKED" | "UNAVAILABLE" | "CANCELLED";
};

const statusTone: Record<Slot["status"], string> = {
  AVAILABLE: "bg-emerald-100 text-emerald-700",
  HELD: "bg-amber-100 text-amber-700",
  BOOKED: "bg-blue-100 text-blue-700",
  UNAVAILABLE: "bg-gray-200 text-gray-700",
  CANCELLED: "bg-rose-100 text-rose-700",
};

function formatTime(dateStr: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateStr));
}

export default function DoctorSchedulePage() {
  const doctorId = useUserStore((s) => s.doctorId);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState<Slot | null>(null);
  const [statusValue, setStatusValue] = useState<Slot["status"]>("AVAILABLE");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");

  const todayDateParam = useMemo(() => {
    const now = new Date();
    return now.toISOString().split("T")[0];
  }, []);

  const [selectedDate, setSelectedDate] = useState<string>(todayDateParam);

  const selectedDateLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(selectedDate));
  }, [selectedDate]);

  const fetchSlots = async (date: string) => {
    if (!doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/doctors/${doctorId}/slots?date=${date}`
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "Failed to fetch slots");
      }

      setSlots(data.slots || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load slots");
      setSlots([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSlots(selectedDate);
  }, [doctorId, selectedDate]);

  const openSlotModal = (slot: Slot) => {
    setActiveSlot(slot);
    setStatusValue(slot.status);
    setCreateMode(false);
    setModalOpen(true);
  };

  const openCreateModal = () => {
    setActiveSlot(null);
    setStatusValue("AVAILABLE");
    setCreateMode(true);
    setNewStart("");
    setNewEnd("");
    setModalOpen(true);
  };

  const handleStatusSave = async () => {
    if (!doctorId || !activeSlot) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/slots`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: activeSlot.id, status: statusValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to update slot");
      await fetchSlots(selectedDate);
      setModalOpen(false);
    } catch (err: any) {
      setError(err?.message || "Failed to update slot");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!doctorId || !activeSlot) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/slots`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: activeSlot.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to delete slot");
      await fetchSlots(selectedDate);
      setModalOpen(false);
    } catch (err: any) {
      setError(err?.message || "Failed to delete slot");
    } finally {
      setDeleting(false);
    }
  };

  const handleCreate = async () => {
    if (!doctorId || !newStart || !newEnd) {
      setError("Provide start and end time for the new slot");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: selectedDate,
          startTime: newStart,
          endTime: newEnd,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to create slot");
      await fetchSlots(selectedDate);
      setModalOpen(false);
    } catch (err: any) {
      setError(err?.message || "Failed to create slot");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {selectedDate === todayDateParam ? "Today" : "Selected date"}
          </p>
          <h1 className="text-2xl font-semibold text-gray-900">{selectedDateLabel}</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={openCreateModal}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Add slot
          </button>
          <Link
            href="/doctor/schedule/weeklySchedule"
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700"
          >
            Edit weekly schedule
          </Link>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Schedule slots</h2>
            <p className="text-sm text-gray-500">All generated 10-minute slots</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={() => setSelectedDate(todayDateParam)}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 whitespace-nowrap"
              disabled={loading}
            >
              Today
            </button>
          </div>
        </div>

        {!doctorId && (
          <p className="text-sm text-red-600">Doctor ID not found. Please log in again.</p>
        )}

        {error && !loading && (
          <div className="text-sm text-red-600">{error}</div>
        )}

        {loading && <p className="text-sm text-gray-600">Loading slots...</p>}

        {!loading && !error && doctorId && slots.length === 0 && (
          <p className="text-sm text-gray-600">No slots for this date.</p>
        )}

        {!loading && !error && slots.length > 0 && (
          <div className="space-y-3">
            {slots.map((slot) => (
              <div
                key={slot.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                onClick={() => openSlotModal(slot)}
              >
                <div>
                  <p className="text-sm font-semibold text-gray-900">
                    {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                  </p>
                  <p className="text-xs text-gray-500">Duration 10 minutes</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusTone[slot.status]}`}>
                  {slot.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{createMode ? "Add new slot" : "Slot details"}</DialogTitle>
          </DialogHeader>

          {!createMode && activeSlot && (
            <div className="space-y-4">
              <div>
                <p className="text-sm text-gray-500">Time</p>
                <p className="text-base font-semibold text-gray-900">
                  {formatTime(activeSlot.startTime)} – {formatTime(activeSlot.endTime)}
                </p>
              </div>
              <div className="space-y-2">
                <label className="text-sm text-gray-700">Status</label>
                <select
                  value={statusValue}
                  onChange={(e) => setStatusValue(e.target.value as Slot["status"])}
                  className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
                >
                  <option value="AVAILABLE">AVAILABLE</option>
                  <option value="HELD">HELD</option>
                  <option value="BOOKED">BOOKED</option>
                  <option value="UNAVAILABLE">UNAVAILABLE</option>
                  <option value="CANCELLED">CANCELLED</option>
                </select>
              </div>
            </div>
          )}

          {createMode && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <span>Date:</span>
                <span className="font-semibold text-gray-900">{selectedDateLabel}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">Start time</label>
                  <input
                    type="time"
                    value={newStart}
                    onChange={(e) => setNewStart(e.target.value)}
                    className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-gray-700">End time</label>
                  <input
                    type="time"
                    value={newEnd}
                    onChange={(e) => setNewEnd(e.target.value)}
                    className="w-full rounded border border-gray-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            {!createMode && (
              <div className="flex w-full justify-between items-center gap-3">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || activeSlot?.status !== "AVAILABLE"}
                  className="rounded-lg border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </button>
                <div className="flex gap-2">
                  <DialogClose asChild>
                    <button
                      type="button"
                      className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </DialogClose>
                  <button
                    type="button"
                    onClick={handleStatusSave}
                    disabled={saving}
                    className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>
            )}

            {createMode && (
              <div className="flex w-full justify-end gap-2">
                <DialogClose asChild>
                  <button
                    type="button"
                    className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                </DialogClose>
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Creating..." : "Create slot"}
                </button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
