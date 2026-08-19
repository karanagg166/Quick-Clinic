"use client";

import { Suspense, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useUserStore } from "@/store/userStore";
import type { DoctorAppointment } from "@/types/doctor";
import { showToast } from "@/lib/toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import StatusBadge from "@/components/general/StatusBadge";
import {
  Clock,
  ChevronLeft,
  Search,
  RotateCcw,
  Calendar,
  CheckCircle2,
  UserX,
  XCircle,
  MessageSquare,
  FileText,
  CreditCard,
  MapPin,
  User,
  ArrowRight,
  Filter,
  History as HistoryIcon
} from "lucide-react";

function DoctorPatientHistoryLogsContent() {
  const searchParams = useSearchParams();
  const initialPatientId = searchParams.get("patientId");

  const doctorId = useUserStore((s) => s.doctorId);

  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const fetchHistoryLogs = useCallback(async () => {
    if (!doctorId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.append("doctorId", doctorId);
      if (statusFilter !== "ALL") params.append("status", statusFilter);
      if (startDate) params.append("startDate", startDate);
      if (endDate) params.append("endDate", endDate);

      const res = await fetch(`/api/doctors/${doctorId}/appointments?${params.toString()}`);
      const data = await res.json();

      if (res.ok && Array.isArray(data)) {
        setAppointments(data);
      } else {
        setAppointments([]);
      }
    } catch (err) {
      console.error("Failed to load patient history logs:", err);
      showToast.error("Failed to load consultation history");
      setAppointments([]);
    } finally {
      setLoading(false);
    }
  }, [doctorId, statusFilter, startDate, endDate]);

  useEffect(() => {
    fetchHistoryLogs();
  }, [fetchHistoryLogs]);

  const handleResetFilters = () => {
    setSearchQuery("");
    setStatusFilter("ALL");
    setStartDate("");
    setEndDate("");
  };

  const filteredLogs = appointments.filter((appt) => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) return true;
    return (
      appt.patientName.toLowerCase().includes(q) ||
      appt.patientString.toLowerCase().includes(q) ||
      appt.city.toLowerCase().includes(q) ||
      appt.id.toLowerCase().includes(q)
    );
  });

  // Calculate Log Metrics
  const totalLogs = appointments.length;
  const completedLogs = appointments.filter((a) => a.status === "COMPLETED").length;
  const noShowLogs = appointments.filter((a) => a.status === "NO_SHOW").length;
  const cancelledLogs = appointments.filter((a) => a.status === "CANCELLED" || a.status === "EXPIRED").length;
  const confirmedDue = appointments.filter((a) => a.status === "CONFIRMED" || a.status === "PENDING").length;

  const completionRate = totalLogs > 0 ? Math.round((completedLogs / totalLogs) * 100) : 0;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 space-y-6 sm:space-y-8 animate-fade-in">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/doctor/patients">
            <ChevronLeft className="w-4 h-4" /> Back to Patients
          </Link>
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild className="text-xs">
            <Link href="/doctor/patients/reports" className="flex items-center gap-1.5">
              <FileText className="w-3.5 h-3.5 text-primary" />
              Patient Reports
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild className="text-xs">
            <Link href="/doctor/today" className="flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-emerald-600" />
              Today's Schedule
            </Link>
          </Button>
        </div>
      </div>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <HistoryIcon className="w-7 h-7 text-primary" />
            Patient Interaction & Consultation History Logs
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Audit log of all patient appointments, attendance outcomes, consultation completions, and care timelines.
          </p>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Total Consultation Logs
              </p>
              <p className="text-2xl font-bold mt-1 text-foreground">{totalLogs}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
              <Clock className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Completed Visits
              </p>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{completedLogs}</p>
                <span className="text-xs text-muted-foreground font-medium">({completionRate}%)</span>
              </div>
            </div>
            <div className="w-11 h-11 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                No-Show Logs
              </p>
              <p className="text-2xl font-bold mt-1 text-orange-600 dark:text-orange-400">{noShowLogs}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-orange-50 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 flex items-center justify-center">
              <UserX className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="border shadow-xs hover:shadow-md transition-shadow">
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Cancelled / Expired
              </p>
              <p className="text-2xl font-bold mt-1 text-rose-600 dark:text-rose-400">{cancelledLogs}</p>
            </div>
            <div className="w-11 h-11 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center">
              <XCircle className="w-5 h-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter & Search Toolbar */}
      <Card className="border shadow-xs">
        <CardContent className="p-4 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            <div className="relative md:col-span-2">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search patient name, email, city..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-sm rounded-xl"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="rounded-xl text-sm">
                <SelectValue placeholder="Status Filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Statuses</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CONFIRMED">Confirmed / Due</SelectItem>
                <SelectItem value="NO_SHOW">No Show</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                <SelectItem value="EXPIRED">Expired</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="date"
              placeholder="From Date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="rounded-xl text-sm"
              title="Start Date"
            />

            <div className="flex gap-2">
              <Input
                type="date"
                placeholder="To Date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="rounded-xl text-sm flex-1"
                title="End Date"
              />

              <Button
                variant="outline"
                size="icon"
                onClick={handleResetFilters}
                className="rounded-xl shrink-0"
                title="Reset filters"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Timeline Logs List */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            Chronological Interaction History ({filteredLogs.length})
          </h2>
          <span className="text-xs text-muted-foreground">
            Showing {filteredLogs.length} entries
          </span>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 w-full rounded-2xl" />
            ))}
          </div>
        ) : filteredLogs.length === 0 ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-12 text-center space-y-3">
              <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                <HistoryIcon className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No History Logs Found</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {totalLogs === 0
                  ? "You have not recorded any patient consultations or interactions yet."
                  : "No history log entries match your filter or search criteria."}
              </p>
              {(statusFilter !== "ALL" || searchQuery || startDate || endDate) && (
                <Button variant="outline" size="sm" onClick={handleResetFilters} className="rounded-xl mt-2">
                  Clear Filters
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filteredLogs.map((log) => {
              const formattedDate = log.appointmentDate
                ? new Date(log.appointmentDate).toLocaleDateString("en-US", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })
                : "N/A";

              const formattedTime = log.appointmentTime
                ? new Date(log.appointmentTime).toLocaleTimeString("en-US", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "UTC",
                  })
                : "N/A";

              return (
                <Card
                  key={log.id}
                  className="rounded-2xl border shadow-xs hover:shadow-md transition-all bg-card overflow-hidden"
                >
                  <CardContent className="p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    {/* Left: Date badge + Patient summary */}
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-12 h-12 rounded-xl bg-primary/10 text-primary flex flex-col items-center justify-center shrink-0 border border-primary/20">
                        <Calendar className="w-5 h-5" />
                      </div>

                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <h3 className="text-base font-bold text-foreground truncate">
                            {log.patientName}
                          </h3>
                          <StatusBadge status={log.status} />
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {log.paymentMethod === "ONLINE" ? "Online Paid" : "Pay at Clinic"}
                          </Badge>
                        </div>

                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1 font-medium text-foreground">
                            <Clock className="w-3.5 h-3.5 text-primary" />
                            {formattedDate} at {formattedTime}
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <User className="w-3.5 h-3.5" />
                            {log.gender || "Patient"} ({log.age || "--"}y)
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5" />
                            {log.city || "Clinic"}
                          </span>
                        </div>

                        <p className="text-xs text-muted-foreground truncate">
                          {log.patientString}
                        </p>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap shrink-0 border-t md:border-t-0 pt-3 md:pt-0">
                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="rounded-xl text-xs font-semibold gap-1.5"
                      >
                        <Link href={`/doctor/appointments/${log.id}`}>
                          <FileText className="w-3.5 h-3.5 text-primary" /> Details
                        </Link>
                      </Button>

                      <Button
                        asChild
                        variant="outline"
                        size="sm"
                        className="rounded-xl text-xs font-semibold gap-1.5"
                      >
                        <Link href="/doctor/chat">
                          <MessageSquare className="w-3.5 h-3.5 text-emerald-600" /> Chat
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default function DoctorPatientHistoryLogsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-center text-sm text-muted-foreground">Loading history logs...</div>}>
      <DoctorPatientHistoryLogsContent />
    </Suspense>
  );
}
