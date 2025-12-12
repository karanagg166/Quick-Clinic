"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";

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

  const todayDate = useMemo(() => {
    const now = new Date();
    return {
      dateParam: now.toISOString().split("T")[0],
      label: new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(now),
    };
  }, []);

  const fetchTodaySlots = async () => {
    if (!doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/doctors/${doctorId}/slots?date=${todayDate.dateParam}`
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
    fetchTodaySlots();
  }, [doctorId, todayDate.dateParam]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-gray-500">Today</p>
          <h1 className="text-2xl font-semibold text-gray-900">{todayDate.label}</h1>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchTodaySlots}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">Today&apos;s slots</h2>
          <p className="text-sm text-gray-500">All generated 10-minute slots</p>
        </div>

        {!doctorId && (
          <p className="text-sm text-red-600">Doctor ID not found. Please log in again.</p>
        )}

        {error && !loading && (
          <div className="text-sm text-red-600">{error}</div>
        )}

        {loading && <p className="text-sm text-gray-600">Loading slots...</p>}

        {!loading && !error && doctorId && slots.length === 0 && (
          <p className="text-sm text-gray-600">No slots for today.</p>
        )}

        {!loading && !error && slots.length > 0 && (
          <div className="space-y-3">
            {slots.map((slot) => (
              <div
                key={slot.id}
                className="flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3 hover:bg-gray-50"
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
    </div>
  );
}
