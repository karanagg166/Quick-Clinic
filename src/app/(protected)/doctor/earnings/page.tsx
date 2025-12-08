"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";

export default function DoctorEarnings() {
  const doctorId = useUserStore((s) => s.doctorId);

  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
  });

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const fetchEarnings = async () => {
    if (!doctorId) return;

    setLoading(true);

    const params = new URLSearchParams();

    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.startTime) params.append("startTime", filters.startTime);
    if (filters.endTime) params.append("endTime", filters.endTime);

    const res = await fetch(`/api/doctors/${doctorId}/earnings?${params.toString()}`);
    const json = await res.json();

    if (res.ok) setData(json);
    else alert(json.error);

    setLoading(false);
  };

  useEffect(() => {
    fetchEarnings();
  }, [doctorId]);

  return (
  <div className="max-w-4xl mx-auto mt-8 p-6 bg-white shadow rounded">

    <h2 className="text-2xl font-bold mb-6 text-center">Earnings Dashboard</h2>

    {/* Filters */}
    <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">

      {/* Start Date */}
      <input
        type="date"
        value={filters.startDate || ""}
        onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
        className="border p-2 rounded"
      />

      {/* End Date */}
      <input
        type="date"
        value={filters.endDate || ""}
        onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
        className="border p-2 rounded"
      />

      {/* Start Time */}
      <input
        type="time"
        value={filters.startTime || ""}
        onChange={(e) => setFilters({ ...filters, startTime: e.target.value })}
        className="border p-2 rounded"
      />

      {/* End Time */}
      <input
        type="time"
        value={filters.endTime || ""}
        onChange={(e) => setFilters({ ...filters, endTime: e.target.value })}
        className="border p-2 rounded"
      />

      {/* Filter Button */}
      <button
        onClick={fetchEarnings}
        disabled={loading}
        className="bg-blue-600 text-white rounded"
      >
        {loading ? "Loading..." : "Filter"}
      </button>
    </div>

    {/* Loading */}
    {loading && (
      <p className="text-center text-blue-600">Fetching earnings...</p>
    )}

    {/* No Results */}
    {!loading && data?.count === 0 && (
      <p className="text-center text-gray-500">No earnings found for filters.</p>
    )}

    {/* Stats */}
    {!loading && data && data.count > 0 && (
      <div className="mt-8 text-center space-y-3">

        <p className="text-lg">
          Total Appointments: <b>{data.count}</b>
        </p>

        <p className="text-2xl font-bold text-green-700">
          Total Earnings: ₹{data.total}
        </p>

      </div>
    )}

  </div>
);

  
}
