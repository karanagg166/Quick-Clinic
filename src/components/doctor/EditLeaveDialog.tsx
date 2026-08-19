"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { showToast } from "@/lib/toast";
import {
  formatUTCToUserTimezone,
  combineDateTimeInUserTimezone,
  getTodayInUserTimezone,
  getCurrentTimeInUserTimezone,
} from "@/lib/dateUtils";
import { Calendar, Clock, Edit3, FastForward, Info } from "lucide-react";

interface EditLeaveDialogProps {
  leave: any | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  doctorId: string;
}

export function EditLeaveDialog({
  leave,
  isOpen,
  onClose,
  onSuccess,
  doctorId,
}: EditLeaveDialogProps) {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (leave && isOpen) {
      try {
        const start = new Date(leave.startDate);
        const end = new Date(leave.endDate);
        setStartDate(start.toISOString().split("T")[0]);
        setStartTime(start.toISOString().slice(11, 16));
        setEndDate(end.toISOString().split("T")[0]);
        setEndTime(end.toISOString().slice(11, 16));
        setReason(leave.reason || "");
      } catch {
        setStartDate("");
        setStartTime("00:00");
        setEndDate("");
        setEndTime("23:59");
        setReason(leave?.reason || "");
      }
    }
  }, [leave, isOpen]);

  const handleEndNow = () => {
    const now = new Date();
    setEndDate(now.toISOString().split("T")[0]);
    setEndTime(now.toISOString().slice(11, 16));
    showToast.info("End date/time set to now. Click 'Save Changes' to confirm.");
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!leave || !doctorId) return;

    if (!startDate || !startTime || !endDate || !endTime || !reason.trim()) {
      showToast.warning("All fields are required");
      return;
    }

    const timeStartClean = startTime.length === 5 ? `${startTime}:00.000Z` : startTime;
    const timeEndClean = endTime.length === 5 ? `${endTime}:00.000Z` : endTime;
    const newStart = new Date(`${startDate}T${timeStartClean}`);
    const newEnd = new Date(`${endDate}T${timeEndClean}`);

    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      showToast.error("Invalid date or time");
      return;
    }

    if (newEnd < newStart) {
      showToast.error("End date/time cannot be before start date/time");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/leave`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaveId: leave.id,
          newStartDate: newStart.toISOString(),
          newEndDate: newEnd.toISOString(),
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update leave");
      }

      showToast.success(data.message || "Leave updated successfully! Freed slots are now available.");
      onSuccess();
      onClose();
    } catch (err: any) {
      showToast.error(err.message || "Failed to update leave");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit3 className="w-5 h-5 text-primary" />
            Edit Leave Request
          </DialogTitle>
          <DialogDescription>
            Update your leave period or return early. Any freed time slots will immediately be restored for patient bookings.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 py-2">
          <div>
            <label className="block text-sm font-semibold mb-1">Reason</label>
            <textarea
              className="w-full border rounded-md p-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason for leave"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Start Date
              </label>
              <input
                type="date"
                className="w-full border rounded-md p-2 text-sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Start Time
              </label>
              <input
                type="time"
                className="w-full border rounded-md p-2 text-sm"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-semibold mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> End Date
              </label>
              <input
                type="date"
                className="w-full border rounded-md p-2 text-sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold mb-1 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> End Time
              </label>
              <input
                type="time"
                className="w-full border rounded-md p-2 text-sm"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
              />
            </div>
          </div>

          {/* Quick Action: End Leave Now if returned early */}
          <div className="p-3 bg-muted/60 rounded-md border flex items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Info className="w-4 h-4 text-blue-500 shrink-0" />
              <span>Back at clinic early?</span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleEndNow}
              className="text-xs flex items-center gap-1 h-8"
            >
              <FastForward className="w-3.5 h-3.5 text-amber-600" />
              Return Now (End Leave Today)
            </Button>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 mt-4">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving Changes..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
