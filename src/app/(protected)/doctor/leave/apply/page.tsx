"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import { showToast } from "@/lib/toast";
import {
  getTodayInUserTimezone,
  getCurrentTimeInUserTimezone,
  combineDateTimeInUserTimezone,
  formatUTCToUserTimezone,
} from "@/lib/dateUtils";

export default function DoctorLeave() {
  const doctorId = useUserStore((s) => s.doctorId);
  const userId=useUserStore((s)=> s.user?.id);
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // client-only computed today values (avoid SSR mismatch)
  const [mounted, setMounted] = useState(false);
  const [todayDate, setTodayDate] = useState("");
  const [todayTime, setTodayTime] = useState("");

  useEffect(() => {
    // Get current date/time in user's local timezone
    setTodayDate(getTodayInUserTimezone());
    setTodayTime(getCurrentTimeInUserTimezone());
    setMounted(true);
  }, []);

  const combineDateTime = (date: string, time: string) => {
    if (!date || !time) return null;
    try {
      // Convert user's local time input to UTC for server storage
      return combineDateTimeInUserTimezone(date, time);
    } catch {
      return null;
    }
  };

  const validateLeave = () => {
    if (!reason || !startDate || !startTime || !endDate || !endTime) {
      showToast.warning("All fields (including start/end time) are required");
      return false;
    }

    const start = combineDateTime(startDate, startTime);
    const end = combineDateTime(endDate, endTime);

    if (!start || !end) {
      showToast.warning("Invalid start or end date/time");
      return false;
    }

    if (end < start) {
      showToast.warning("End date/time cannot be before start date/time");
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!doctorId) {
      showToast.error("Doctor ID not found");
      return;
    }

    if (!validateLeave()) return;

    setSubmitting(true);

    try {
      const start = combineDateTime(startDate, startTime)!;
      const end = combineDateTime(endDate, endTime)!;

      const response = await fetch(`/api/doctors/${doctorId}/leave`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          userId,
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to submit leave request");
      }

      showToast.success("Leave request submitted successfully!");

      // Reset form
      setReason("");
      setStartDate("");
      setStartTime("");
      setEndDate("");
      setEndTime("");
    } catch (error: any) {
      showToast.error(error.message || "Failed to submit leave request");
    } finally {
      setSubmitting(false);
    }
  };

  // Helper: only enforce time min when selected date equals today
  const timeMinForDate = (date: string) => {
    if (!mounted) return undefined; // don't set min during SSR / initial render
    return date === todayDate ? todayTime : undefined;
  };

  // End date min: can't be earlier than startDate (or today if no start selected)
  const computedEndDateMin = mounted ? (startDate || todayDate) : undefined;
  const computedStartDateMin = mounted ? todayDate : undefined;

  return (
    <div className="max-w-lg mx-auto mt-8 p-6 bg-white shadow-md rounded-lg">
      <h2 className="text-2xl font-bold text-center mb-6">Doctor Leave Request</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Reason */}
        <div>
          <label className="block font-semibold mb-1">Reason</label>
          <textarea
            className="w-full border p-2 rounded"
            placeholder="Enter reason for leave"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            required
          />
        </div>

        {/* Start Date + Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">Start Date</label>
            {/* leave min undefined during SSR to avoid mismatch */}
            <input
              type="date"
              className="w-full border p-2 rounded"
              value={startDate}
              min={computedStartDateMin}
              onChange={(e) => setStartDate(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Start Time</label>
            <input
              type="time"
              className="w-full border p-2 rounded"
              value={startTime}
              min={timeMinForDate(startDate)}
              onChange={(e) => setStartTime(e.target.value)}
              required
            />
          </div>
        </div>

        {/* End Date + Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block font-semibold mb-1">End Date</label>
            <input
              type="date"
              className="w-full border p-2 rounded"
              value={endDate}
              min={computedEndDateMin}
              onChange={(e) => setEndDate(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">End Time</label>
            <input
              type="time"
              className="w-full border p-2 rounded"
              value={endTime}
              min={timeMinForDate(endDate)}
              onChange={(e) => setEndTime(e.target.value)}
              required
            />
          </div>
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit Leave Request"}
        </button>
      </form>
    </div>
  );
}
