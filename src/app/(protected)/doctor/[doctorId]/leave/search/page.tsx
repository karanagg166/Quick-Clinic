"use client";

import { useState } from "react";

export default function DoctorLeaveSearch() {
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const [loading, setLoading] = useState(false);

  const [results, setResults] = useState<any[]>([]);
  const handleSubmit = async (e: React.FormEvent) => {
  e.preventDefault();
  setLoading(true);

  try {
    // Build query params
    const params = new URLSearchParams();

    if (startDate) params.append("startDate", startDate);
    if (endDate) params.append("endDate", endDate);
    if (reason) params.append("reason", reason);
    if (startTime) params.append("startTime", startTime);
    if (endTime) params.append("endTime", endTime);

    const response = await fetch(`/api/doctor/leave/?${params.toString()}`, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || "Failed to search leave requests");
    }

    const data = await response.json();
    setResults(data);
  } 
  catch (err: any) {
    alert(err.message || "Error searching leave requests");
    console.error("Leave Search Error:", err);
  } 
  finally {
    setLoading(false);
  }
};

return <div>
    <h1 className="text-2xl font-bold mb-4">Search Leave Requests</h1>
</div>

}