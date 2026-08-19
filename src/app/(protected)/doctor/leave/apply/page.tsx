"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";
import { showToast } from "@/lib/toast";
import {
  getTodayInUserTimezone,
  getCurrentTimeInUserTimezone,
} from "@/lib/dateUtils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, CalendarDays, Loader2 } from "lucide-react";

export default function DoctorLeave() {
  const router = useRouter();
  const doctorId = useUserStore((s) => s.doctorId);
  const userId = useUserStore((s) => s.user?.id);
  const [reason, setReason] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
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
      const timeClean = time.length === 5 ? `${time}:00.000Z` : time.endsWith("Z") ? time : `${time}.000Z`;
      const dateObj = new Date(`${date}T${timeClean}`);
      if (isNaN(dateObj.getTime())) return null;
      return dateObj;
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

      // Reset form & redirect to doctor dashboard
      setReason("");
      setStartDate("");
      setStartTime("");
      setEndDate("");
      setEndTime("");
      router.push("/doctor");
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
    <div className="max-w-xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Navigation Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/doctor/leave">
            <ArrowLeft className="w-4 h-4" /> Back to Leaves
          </Link>
        </Button>
        <Button variant="outline" size="sm" asChild>
          <Link href="/doctor">Dashboard</Link>
        </Button>
      </div>

      <Card className="border shadow-sm">
        <CardHeader>
          <div className="flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-primary" />
            <CardTitle className="text-2xl font-bold">Request Leave</CardTitle>
          </div>
          <CardDescription>
            Submit your time off dates. Covered time slots will automatically be locked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Reason */}
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason for Leave</Label>
              <Textarea
                id="reason"
                className="w-full resize-none"
                placeholder="e.g. Attending Medical Conference, Family vacation"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </div>

            {/* Start Date + Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="startDate">Start Date</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={startDate}
                  min={computedStartDateMin}
                  onChange={(e) => {
                    setStartDate(e.target.value);
                    if (!endDate) setEndDate(e.target.value);
                  }}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="startTime">Start Time</Label>
                <Input
                  id="startTime"
                  type="time"
                  value={startTime}
                  min={timeMinForDate(startDate)}
                  onChange={(e) => setStartTime(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* End Date + Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="endDate">End Date</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={endDate}
                  min={computedEndDateMin}
                  onChange={(e) => setEndDate(e.target.value)}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="endTime">End Time</Label>
                <Input
                  id="endTime"
                  type="time"
                  value={endTime}
                  min={timeMinForDate(endDate)}
                  onChange={(e) => setEndTime(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <Button
                type="submit"
                disabled={submitting}
                className="w-full gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                  </>
                ) : (
                  "Submit Leave Request"
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
