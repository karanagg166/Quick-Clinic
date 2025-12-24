"use client";

import { useState} from "react";
import { useUserStore } from "@/store/userStore";
import { showToast } from "@/lib/toast";

export default function DoctorLeaveSearch() {
  // selector form — reactive
  const doctorId = useUserStore((state) => state.doctorId);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [startTime, setStartTime] = useState(""); // NEW
  const [endTime, setEndTime] = useState(""); // NEW
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // reactive flag that causes re-render when doctorId becomes available
  const doctorReady = Boolean(doctorId && doctorId.length > 0);
  const combineDateTime = (date: string, time: string) => { 
   if(!time){
    const iso = new Date(`${date}T00:00`);
   if(isNaN(iso.getTime())) return null;
   return iso;
   }
   if(!date) return null;
   const iso = new Date(`${date}T${time}`);
   if(isNaN(iso.getTime())) return null;
   return iso;


  }
 

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    setErrorMsg(null);

    if (!doctorReady) {
      showToast.warning("Doctor ID not loaded yet. Please wait...");
      return;
    }

    setLoading(true);

    try {
      const params = new URLSearchParams();
      const start=combineDateTime(startDate, startTime);
      const end=combineDateTime(endDate, endTime);
      
      if(start) params.append("startDate", start.toISOString());
      if(end) params.append("endDate", end.toISOString());
      
      if (reason) params.append("reason", reason);
      console.log(start,end);
      const url = `/api/doctors/${doctorId}/leave?${params.toString()}`;

      const response = await fetch(url, {
        method: "GET",
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to search leave requests");
      }

      const data = await response.json();
      setResults(data.leaves || []);
    } catch (err: any) {
      const msg = err?.message || "Error searching leave requests";
      setErrorMsg(msg);
      console.error("Leave Search Error:", err);
      showToast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const buttonDisabled = loading || !doctorReady;

  return (
    <div className="max-w-4xl mx-auto mt-8 p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-2xl font-bold mb-6">Search Leave Requests</h1>

      <form onSubmit={handleSubmit} className="mb-8 space-y-4">
        <div>
          <label className="block font-semibold mb-1">Start Date</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Start Time</label>
          <input
            type="time"
            className="w-full border p-2 rounded"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>

        <div>
          <label className="block font-semibold mb-1">End Date</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
       <div>
          <label className="block font-semibold mb-1">End Time</label>
          <input
            type="time"
            className="w-full border p-2 rounded"
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
          />
        </div>
        <div>
          <label className="block font-semibold mb-1">Reason (optional)</label>
          <textarea
            className="w-full border p-2 rounded"
            placeholder="Search by reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>

        <button
          type="submit"
          disabled={buttonDisabled}
          className={`w-full py-2 rounded text-white ${
            buttonDisabled
              ? "bg-gray-400 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-700"
          }`}
        >
          {loading
            ? "Searching..."
            : !doctorReady
            ? "Waiting for Doctor ID..."
            : "Search Leave Requests"}
        </button>
      </form>

      {errorMsg && (
        <p className="text-red-600 mb-4 text-center">{errorMsg}</p>
      )}

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
                    <td className="border p-2">
                      {leave.startDate ? new Date(leave.startDate).toLocaleDateString() : "-"}
                    </td>
                    <td className="border p-2">
                      {leave.endDate ? new Date(leave.endDate).toLocaleDateString() : "-"}
                    </td>
                    <td className="border p-2">{leave.reason ?? "-"}</td>
                    <td className="border p-2">
                      {leave.applyAt ? new Date(leave.applyAt).toLocaleDateString() : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        !loading && <p className="text-gray-500 text-center py-4">No results found</p>
      )}
    </div>
  );
}
