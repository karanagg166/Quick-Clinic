"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Calendar, PlusCircle, Trash2, Clock, CheckCircle2, AlertCircle } from "lucide-react";

export default function DoctorLeaveManagementPage() {
  const doctorId = useUserStore((state) => state.doctorId);
  const [loading, setLoading] = useState(false);
  const [leaves, setLeaves] = useState<any[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const fetchLeaves = async () => {
    if (!doctorId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/leave`, {
        method: "GET",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setLeaves(data.leaves || []);
      } else {
        showToast.error("Failed to load leave records");
      }
    } catch (err: any) {
      showToast.error(err?.message || "Error loading leaves");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (doctorId) {
      fetchLeaves();
    }
  }, [doctorId]);

  const handleCancelLeave = async (leaveId: string) => {
    if (!doctorId) return;
    const confirmed = window.confirm(
      "Are you sure you want to cancel this leave? Covered time slots will be freed back to AVAILABLE, but previously cancelled appointments will remain cancelled."
    );
    if (!confirmed) return;

    setCancellingId(leaveId);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/leave?leaveId=${leaveId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        showToast.success("Leave cancelled successfully! Slots are now available for booking.");
        setLeaves((prev) => prev.filter((l) => l.id !== leaveId));
      } else {
        const errorData = await res.json().catch(() => ({}));
        showToast.error(errorData.error || "Failed to cancel leave");
      }
    } catch (err: any) {
      showToast.error(err?.message || "Error cancelling leave");
    } finally {
      setCancellingId(null);
    }
  };

  const now = new Date();
  const activeAndUpcoming = leaves.filter((l) => new Date(l.endDate) >= now);
  const pastLeaves = leaves.filter((l) => new Date(l.endDate) < now);

  const getLeaveStatus = (leave: any) => {
    const start = new Date(leave.startDate);
    const end = new Date(leave.endDate);
    if (now < start) return { label: "Upcoming", variant: "secondary" as const, color: "bg-blue-100 text-blue-800" };
    if (now > end) return { label: "Past / Completed", variant: "outline" as const, color: "bg-gray-100 text-gray-700" };
    return { label: "Active Now", variant: "default" as const, color: "bg-amber-100 text-amber-800" };
  };

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Doctor Leave Management</h1>
          <p className="text-muted-foreground mt-1">
            Manage your scheduled time off, cancel leaves, and review past leave history.
          </p>
        </div>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/doctor/leave/apply" className="flex items-center gap-2">
              <PlusCircle className="w-4 h-4" />
              Apply New Leave
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/doctor/leave/history" className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              Detailed History
            </Link>
          </Button>
        </div>
      </div>

      {/* Active & Upcoming Leaves Section */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <Calendar className="w-5 h-5 text-primary" />
            Active & Upcoming Leaves ({activeAndUpcoming.length})
          </CardTitle>
          <CardDescription>
            Scheduled leaves where time slots are locked as ON_LEAVE. Cancelling a leave frees the slots for new patient bookings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground py-6 text-center">Loading leaves...</p>
          ) : activeAndUpcoming.length === 0 ? (
            <div className="text-center py-8 border border-dashed rounded-lg">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
              <p className="font-semibold text-foreground">No active or upcoming leaves</p>
              <p className="text-sm text-muted-foreground mt-1">You are available for all regular schedule slots.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {activeAndUpcoming.map((leave) => {
                const status = getLeaveStatus(leave);
                const isCancelling = cancellingId === leave.id;

                return (
                  <div
                    key={leave.id}
                    className="p-4 rounded-lg border bg-card flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1.5 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${status.color}`}>
                          {status.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Applied {new Date(leave.applyAt || leave.createdAt || leave.startDate).toLocaleDateString()}
                        </span>
                      </div>
                      <div className="text-sm font-medium text-foreground">
                        {new Date(leave.startDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} —{" "}
                        {new Date(leave.endDate).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        <span className="font-medium text-foreground">Reason:</span> {leave.reason}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={isCancelling}
                        onClick={() => handleCancelLeave(leave.id)}
                        className="flex items-center gap-1.5"
                      >
                        <Trash2 className="w-4 h-4" />
                        {isCancelling ? "Cancelling..." : "Cancel Leave"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Past / Older Leaves Section */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl text-muted-foreground">
            <Clock className="w-5 h-5" />
            Older / Past Leaves ({pastLeaves.length})
          </CardTitle>
          <CardDescription>
            Historical records of completed leaves. Past leaves cannot be cancelled retroactively.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground py-4 text-center">Loading past records...</p>
          ) : pastLeaves.length === 0 ? (
            <p className="text-muted-foreground py-4 text-center text-sm">No historical leaves on record.</p>
          ) : (
            <div className="space-y-3">
              {pastLeaves.map((leave) => (
                <div
                  key={leave.id}
                  className="p-3.5 rounded-lg border bg-muted/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-sm"
                >
                  <div>
                    <div className="font-medium text-foreground">
                      {new Date(leave.startDate).toLocaleDateString([], { dateStyle: "medium" })} to{" "}
                      {new Date(leave.endDate).toLocaleDateString([], { dateStyle: "medium" })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Reason: {leave.reason}
                    </div>
                  </div>
                  <Badge variant="outline" className="self-start sm:self-auto text-xs">
                    Completed
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
