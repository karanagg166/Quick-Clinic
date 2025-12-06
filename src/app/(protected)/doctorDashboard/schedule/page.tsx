"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";

export default function DoctorSchedule() {
  const { doctorId } = useUserStore();
  const days = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  // Default empty schedule
  const defaultSchedule = days.map(() => ({
    morningStart: "",
    morningEnd: "",
    eveningStart: "",
    eveningEnd: "",
  }));

  const [schedule, setSchedule] = useState(defaultSchedule);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // --------------------------------------------------
  // GET Existing schedule on load
  // --------------------------------------------------
  useEffect(() => {
    const loadSchedule = async () => {
      try {
        if (!doctorId) return;

        setLoading(true);

        const res = await fetch(`/api/doctors/${doctorId}/schedule`, {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) return; // no schedule yet

        const data = await res.json();

        // If backend saved schedule, update state
        if (data.schedule?.weeklySchedule) {
          setSchedule(data.schedule.weeklySchedule);
        }

      } catch (err) {
        console.error("Fetch schedule error:", err);
      } finally {
        setLoading(false);
      }
    };

    loadSchedule();
  }, [doctorId]);


  // --------------------------------------------------
  // Update single field in table
  // --------------------------------------------------
  const updateField = (dayIndex: number, field: keyof typeof schedule[0], value: string) => {
    setSchedule((prev) => {
      const updated = [...prev];
      updated[dayIndex] = { ...updated[dayIndex], [field]: value };
      return updated;
    });
  };


  // --------------------------------------------------
  // SAVE schedule (POST)
  // --------------------------------------------------
  const saveSchedule = async () => {
    try {
      if (!doctorId) {
        alert("Doctor ID not found");
        return;
      }

      setSaving(true);

      const res = await fetch(`/api/doctors/${doctorId}/schedule`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weeklySchedule: schedule }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to save schedule");
      }

      alert("Schedule saved successfully!");

    } catch (err: any) {
      alert(err.message || "Save failed");
      console.error("Save Schedule Error:", err);
    } finally {
      setSaving(false);
    }
  };


  // --------------------------------------------------
  // RENDER UI
  // --------------------------------------------------
  return (
    <div className="max-w-4xl mx-auto mt-8 p-6 bg-white shadow-md rounded-lg">

      <h2 className="text-2xl font-bold text-center mb-6">
        Weekly Availability
      </h2>

      {loading && (
        <p className="text-blue-600 mb-4 text-center">Loading schedule...</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border border-gray-300 text-sm">
          <thead>
            <tr className="bg-gray-100">
              <th className="border p-2">Day</th>
              <th className="border p-2">Morning Start</th>
              <th className="border p-2">Morning End</th>
              <th className="border p-2">Evening Start</th>
              <th className="border p-2">Evening End</th>
            </tr>
          </thead>

          <tbody>
            {days.map((day, index) => (
              <tr key={day}>
                <td className="border p-2 font-semibold">{day}</td>

                <td className="border p-2">
                  <input
                    type="time"
                    value={schedule[index].morningStart}
                    onChange={(e) =>
                      updateField(index, "morningStart", e.target.value)
                    }
                    className="border rounded p-1 w-full"
                  />
                </td>

                <td className="border p-2">
                  <input
                    type="time"
                    value={schedule[index].morningEnd}
                    onChange={(e) =>
                      updateField(index, "morningEnd", e.target.value)
                    }
                    className="border rounded p-1 w-full"
                  />
                </td>

                <td className="border p-2">
                  <input
                    type="time"
                    value={schedule[index].eveningStart}
                    onChange={(e) =>
                      updateField(index, "eveningStart", e.target.value)
                    }
                    className="border rounded p-1 w-full"
                  />
                </td>

                <td className="border p-2">
                  <input
                    type="time"
                    value={schedule[index].eveningEnd}
                    onChange={(e) =>
                      updateField(index, "eveningEnd", e.target.value)
                    }
                    className="border rounded p-1 w-full"
                  />
                </td>

              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={saveSchedule}
        disabled={saving}
        className="mt-6 w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving..." : "Save Schedule"}
      </button>
    </div>
  );
}
