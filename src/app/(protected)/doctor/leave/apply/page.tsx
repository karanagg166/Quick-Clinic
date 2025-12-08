"use client";

import { useState } from "react";
import { useUserStore } from "@/store/userStore";
export default function DoctorLeave() {
  // safer selector form
  const doctorId = useUserStore((s) => s.doctorId);

  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState(""); // NEW
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState(""); // NEW
  const [submitting, setSubmitting] = useState(false);
  const todayDate = new Date().toISOString().split("T")[0];
  const todayTime = new Date().toTimeString().slice(0, 5); // "HH:mm"
  const combineDateTime = (date: string, time: string) => {
    // date expected "YYYY-MM-DD", time "HH:mm"
    if (!date || !time) return null;
    // create ISO string in local timezone
    const iso = new Date(`${date}T${time}`);
    if (isNaN(iso.getTime())) return null;
    return iso;
  };

  const validateLeave = () => {
    if (!reason || !startDate || !startTime || !endDate || !endTime) {
      alert("All fields (including start/end time) are required");
      return false;
    }

    const start = combineDateTime(startDate, startTime);
    const end = combineDateTime(endDate, endTime);

    if (!start || !end) {
      alert("Invalid start or end date/time");
      return false;
    }

    if (end < start) {
      alert("End date/time cannot be before start date/time");
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!doctorId) {
      alert("Doctor ID not found");
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
          startDate: start.toISOString(),
          endDate: end.toISOString(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to submit leave request");
      }

      alert("Leave request submitted successfully!");

      // Reset form
      setReason("");
      setStartDate("");
      setStartTime("");
      setEndDate("");
      setEndTime("");
    } catch (error: any) {
      alert(error.message || "Failed to submit leave request");
    } finally {
      setSubmitting(false);
    }
  };

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
            <input
              type="date"
              className="w-full border p-2 rounded"
              value={startDate}
              min={startDate}
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
              min={todayTime}
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
              min={todayDate}
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
              min={todayTime}
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
