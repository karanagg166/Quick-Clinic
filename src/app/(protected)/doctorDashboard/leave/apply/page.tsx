"use client";

import { useState } from "react";

export default function DoctorLeave() {
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const validateLeave = () => {
    if (!reason || !startDate || !endDate || !startTime || !endTime) {
      alert("All fields are required");
      return false;
    }

    // Convert to comparable values
    const start = new Date(`${startDate}T${startTime}`);
    const end = new Date(`${endDate}T${endTime}`);

    if (end < start) {
      alert("End date/time cannot be before start date/time");
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateLeave()) return;

    setSubmitting(true);

    try {
      const response = await fetch("/api/doctor/leave", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          startDate,
          endDate,
          startTime,
          endTime,
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
      setEndDate("");
      setStartTime("");
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

        {/* Start Date */}
        <div>
          <label className="block font-semibold mb-1">Start Date</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </div>

        {/* End Date */}
        <div>
          <label className="block font-semibold mb-1">End Date</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>

        {/* Start Time */}
        <div>
          <label className="block font-semibold mb-1">Start Time</label>
          <input
            type="time"
            className="w-full border p-2 rounded"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </div>

        {/* End Time */}
        <div>
          <label className="block font-semibold mb-1">End Time</label>
          <input
            type="time"
            className="w-full border p-2 rounded"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
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
