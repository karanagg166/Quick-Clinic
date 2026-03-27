"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";
import { showToast } from "@/lib/toast";

export default function DoctorLeaveHistory() {
  const doctorId = useUserStore((state) => state.doctorId);

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Filter state (optional, user can manually search too)
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");

  const doctorReady = Boolean(doctorId && doctorId.length > 0);

  const fetchLeaves = async (filters?: { startDate?: string; endDate?: string; reason?: string }) => {
    if (!doctorReady) return;

    setLoading(true);
    setErrorMsg(null);

    try {
      const params = new URLSearchParams();
      if (filters?.startDate) params.append("startDate", new Date(`${filters.startDate}T00:00`).toISOString());
      if (filters?.endDate) params.append("endDate", new Date(`${filters.endDate}T23:59`).toISOString());
      if (filters?.reason) params.append("reason", filters.reason);

      const url = `/api/doctors/${doctorId}/leave?${params.toString()}`;
      const response = await fetch(url, { method: "GET", credentials: "include" });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to fetch leave requests");
      }

      const data = await response.json();
      setResults(data.leaves || []);
    } catch (err: any) {
      const msg = err?.message || "Error fetching leave requests";
      setErrorMsg(msg);
      showToast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch all leaves on mount
  useEffect(() => {
    if (doctorReady) {
      fetchLeaves();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorReady]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchLeaves({ startDate, endDate, reason });
  };

  const handleCancelLeave = async (leaveId: string) => {
    if (!doctorId) return;
    const confirmed = window.confirm(
      "Are you sure you want to cancel this leave? Affected slots will be restored."
    );
    if (!confirmed) return;

    try {
      const response = await fetch(
        `/api/doctors/${doctorId}/leave?leaveId=${leaveId}`,
        { method: "DELETE", credentials: "include" }
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to cancel leave");
      }

      showToast.success("Leave cancelled and slots restored!");
      setResults((prev) => prev.filter((l) => l.id !== leaveId));
    } catch (err: any) {
      showToast.error(err.message || "Failed to cancel leave");
    }
  };

  const handleEndLeaveEarly = async (leaveId: string) => {
    if (!doctorId) return;
    const confirmed = window.confirm(
      "End this leave now? Slots after today will be freed, but previously cancelled appointments will remain cancelled."
    );
    if (!confirmed) return;

    try {
      const response = await fetch(`/api/doctors/${doctorId}/leave`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveId,
          newEndDate: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to end leave early");
      }

      showToast.success("Leave ended early. Freed slots restored!");
      fetchLeaves();
    } catch (err: any) {
      showToast.error(err.message || "Failed to end leave early");
    }
  };

  const getLeaveStatus = (leave: any) => {
    const now = new Date();
    const start = new Date(leave.startDate);
    const end = new Date(leave.endDate);

    if (now < start) return { label: "Upcoming", color: "bg-blue-100 text-blue-800" };
    if (now > end) return { label: "Past", color: "bg-gray-100 text-gray-600" };
    return { label: "Active", color: "bg-green-100 text-green-800" };
  };

  return (
    <div className="max-w-4xl mx-auto mt-8 p-6 bg-white shadow-md rounded-lg">
      <h1 className="text-2xl font-bold mb-6">Leave History</h1>

      {/* Optional filter form */}
      <form onSubmit={handleSearch} className="mb-8 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
            <label className="block font-semibold mb-1">End Date</label>
            <input
              type="date"
              className="w-full border p-2 rounded"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block font-semibold mb-1">Reason (optional)</label>
            <input
              className="w-full border p-2 rounded"
              placeholder="Search by reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={loading || !doctorReady}
            className={`flex-1 py-2 rounded text-white ${
              loading || !doctorReady ? "bg-gray-400 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700"
            }`}
          >
            {loading ? "Searching..." : "Search"}
          </button>
          <button
            type="button"
            onClick={() => {
              setStartDate("");
              setEndDate("");
              setReason("");
              fetchLeaves();
            }}
            className="px-4 py-2 rounded border text-gray-600 hover:bg-gray-50"
          >
            Reset
          </button>
        </div>
      </form>

      {errorMsg && (
        <p className="text-red-600 mb-4 text-center">{errorMsg}</p>
      )}

      {loading && (
        <p className="text-gray-500 text-center py-4">Loading leaves...</p>
      )}

      {!loading && results.length > 0 && (
        <div>
          <h2 className="text-xl font-semibold mb-4">
            {results.length} Leave(s) Found
          </h2>
          <div className="space-y-4">
            {results.map((leave: any) => {
              const status = getLeaveStatus(leave);
              const isActive = status.label === "Active";
              const isUpcoming = status.label === "Upcoming";

              return (
                <div
                  key={leave.id}
                  className={`p-4 rounded-lg border ${
                    isActive ? "border-green-300 bg-green-50" :
                    isUpcoming ? "border-blue-300 bg-blue-50" :
                    "border-gray-200 bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`text-xs font-semibold px-2 py-1 rounded ${status.color}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-500">Start</p>
                          <p className="font-medium">
                            {new Date(leave.startDate).toLocaleString()}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-500">End</p>
                          <p className="font-medium">
                            {new Date(leave.endDate).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 text-sm">
                        <p className="text-gray-500">Reason</p>
                        <p className="font-medium">{leave.reason || "-"}</p>
                      </div>
                      {leave.applyAt && (
                        <p className="text-xs text-gray-400 mt-2">
                          Applied: {new Date(leave.applyAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>

                    <div className="flex flex-col gap-2 ml-4">
                      {isActive && (
                        <button
                          onClick={() => handleEndLeaveEarly(leave.id)}
                          className="bg-orange-500 text-white px-3 py-1 rounded hover:bg-orange-600 text-sm whitespace-nowrap"
                        >
                          End Leave Early
                        </button>
                      )}
                      {(isActive || isUpcoming) && (
                        <button
                          onClick={() => handleCancelLeave(leave.id)}
                          className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 text-sm whitespace-nowrap"
                        >
                          Cancel Leave
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && results.length === 0 && (
        <p className="text-gray-500 text-center py-4">No leave records found</p>
      )}
    </div>
  );
}
