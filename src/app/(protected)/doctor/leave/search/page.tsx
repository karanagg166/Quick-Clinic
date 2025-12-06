"use client";

import { useState } from "react";
import { useUserStore } from "@/store/userStore";

export default function DoctorLeaveSearch() {
  const { doctorId } = useUserStore();
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const [loading, setLoading] = useState(false);

  const [results, setResults] = useState<any[]>([]);
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!doctorId) {
      alert("Doctor ID not found");
      return;
    }

    setLoading(true);

    try {
      // Build query params
      const params = new URLSearchParams();

      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);
      if (reason) params.append("reason", reason);

      const response = await fetch(`/api/doctors/${doctorId}/leave?${params.toString()}`, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to search leave requests");
      }

      const data = await response.json();
      setResults(data.leaves || []);
    } 
    catch (err: any) {
      alert(err.message || "Error searching leave requests");
      console.error("Leave Search Error:", err);
    } 
    finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto mt-8 p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-2xl font-bold mb-6">Search Leave Requests</h1>

      <form onSubmit={handleSubmit} className="mb-8 space-y-4">
        
        {/* Start Date */}
        <div>
          <label className="block font-semibold mb-1">Start Date</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
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
          />
        </div>

        {/* Reason */}
        <div>
          <label className="block font-semibold mb-1">Reason (optional)</label>
          <textarea
            className="w-full border p-2 rounded"
            placeholder="Search by reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        {/* Submit Button */}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? "Searching..." : "Search Leave Requests"}
        </button>
      </form>

      {/* Results */}
      {results.length > 0 ? (
        <div>
          <h2 className="text-xl font-semibold mb-4">Results</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse border border-gray-300">
              <thead className="bg-gray-100">
                <tr>
                  <th className="border p-2">Start Date</th>
                  <th className="border p-2">End Date</th>
                  <th className="border p-2">Reason</th>
                  <th className="border p-2">Applied At</th>
                </tr>
              </thead>
              <tbody>
                {results.map((leave: any, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="border p-2">{new Date(leave.startDate).toLocaleDateString()}</td>
                    <td className="border p-2">{new Date(leave.endDate).toLocaleDateString()}</td>
                    <td className="border p-2">{leave.reason}</td>
                    <td className="border p-2">{new Date(leave.applyAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        loading === false && <p className="text-gray-500 text-center py-4">No results found</p>
      )}
    </div>
  );
}