"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { useUserStore } from "@/store/userStore";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle2,
  AlertCircle,
  User,
  CalendarDays,
  LayoutGrid,
  CalendarRange,
  ArrowRight,
  Sparkles,
  Phone,
  Mail,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";

type SlotStatus = "AVAILABLE" | "HELD" | "BOOKED" | "UNAVAILABLE" | "CANCELLED" | "ON_LEAVE";

interface PatientInfo {
  name?: string;
  email?: string;
  phoneNo?: string;
  gender?: string;
  age?: number;
}

interface AppointmentInfo {
  id: string;
  status: string;
  patient?: {
    user?: PatientInfo;
  };
}

interface SlotItem {
  id: string;
  startTime: string;
  endTime: string;
  status: SlotStatus;
  appointment?: AppointmentInfo | null;
}

interface TimelineBlock {
  type: "BUSY" | "FREE" | "BLOCKED" | "ON_LEAVE";
  startTime: string;
  endTime: string;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  slotCount: number;
  bookedCount: number;
  title: string;
  description: string;
  status: SlotStatus;
  slots: SlotItem[];
}

interface DayMetrics {
  totalSlots: number;
  availableCount: number;
  bookedCount: number;
  heldCount: number;
  unavailableCount: number;
  onLeaveCount: number;
  totalWorkingMinutes: number;
  freeMinutes: number;
  busyMinutes: number;
  occupancyPercentage: number;
  nextAppointmentTime?: string;
}

interface WeekDayItem {
  date: string;
  dayName: string;
  metrics: DayMetrics;
  slotsCount: number;
  bookedCount: number;
  availableCount: number;
  timelineBlocks: TimelineBlock[];
}

interface MonthDayItem {
  date: string;
  dayNumber: number;
  dayName: string;
  dayOfWeek?: number;
  totalSlots: number;
  bookedCount: number;
  availableCount: number;
  unavailableCount: number;
  isLeave: boolean;
  statusSummary?: "ON_LEAVE" | "BOOKED" | "FREE_WHOLE_DAY";
  occupancyRate: number;
}

const statusTone: Record<SlotStatus, { bg: string; text: string; border: string }> = {
  AVAILABLE: { bg: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400", text: "text-emerald-600", border: "border-emerald-200 dark:border-emerald-800" },
  HELD: { bg: "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400", text: "text-amber-600", border: "border-amber-200 dark:border-amber-800" },
  BOOKED: { bg: "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400", text: "text-blue-600", border: "border-blue-200 dark:border-blue-800" },
  UNAVAILABLE: { bg: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300", text: "text-slate-500", border: "border-slate-200 dark:border-slate-700" },
  CANCELLED: { bg: "bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400", text: "text-rose-600", border: "border-rose-200 dark:border-rose-800" },
  ON_LEAVE: { bg: "bg-purple-50 text-purple-700 dark:bg-purple-950/30 dark:text-purple-400", text: "text-purple-600", border: "border-purple-200 dark:border-purple-800" },
};

function formatTime(dateStr: string) {
  if (!dateStr) return "";
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(dateStr));
}

function formatMinutesToHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function DoctorSchedulePage() {
  const doctorId = useUserStore((s) => s.doctorId);

  const [viewMode, setViewMode] = useState<"day" | "week" | "month">("day");
  const todayStr = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);

  // Day view state
  const [daySlots, setDaySlots] = useState<SlotItem[]>([]);
  const [timelineBlocks, setTimelineBlocks] = useState<TimelineBlock[]>([]);
  const [dayMetrics, setDayMetrics] = useState<DayMetrics | null>(null);

  // Week view state
  const [weekDays, setWeekDays] = useState<WeekDayItem[]>([]);
  const [weekMetrics, setWeekMetrics] = useState<{ totalSlots: number; totalBooked: number; totalAvailable: number; occupancyRate: number } | null>(null);

  // Month view state
  const [monthDays, setMonthDays] = useState<MonthDayItem[]>([]);
  const [firstDayOffset, setFirstDayOffset] = useState<number>(0);
  const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
  const [selectedMonth, setSelectedMonth] = useState<number>(new Date().getMonth() + 1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [activeSlot, setActiveSlot] = useState<SlotItem | null>(null);
  const [statusValue, setStatusValue] = useState<SlotStatus>("AVAILABLE");
  const [saving, setSaving] = useState(false);

  // Fetch Day Data
  const fetchDayData = useCallback(async (date: string) => {
    if (!doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/schedule/overview?view=day&date=${date}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load day schedule");

      setDaySlots(data.slots || []);
      setTimelineBlocks(data.timelineBlocks || []);
      setDayMetrics(data.metrics || null);
    } catch (err: any) {
      setError(err?.message || "Failed to load schedule");
      setDaySlots([]);
      setTimelineBlocks([]);
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  // Fetch Week Data
  const fetchWeekData = useCallback(async (date: string) => {
    if (!doctorId) return;
    setLoading(true);
    setError(null);
    try {
      // Calculate Monday of the week
      const d = new Date(`${date}T00:00:00.000Z`);
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setUTCDate(diff));
      const mondayStr = monday.toISOString().split("T")[0];

      const res = await fetch(`/api/doctors/${doctorId}/schedule/overview?view=week&startDate=${mondayStr}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load week schedule");

      setWeekDays(data.days || []);
      setWeekMetrics(data.weekMetrics || null);
    } catch (err: any) {
      setError(err?.message || "Failed to load week schedule");
      setWeekDays([]);
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  // Fetch Month Data
  const fetchMonthData = useCallback(async (year: number, month: number) => {
    if (!doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/schedule/overview?view=month&year=${year}&month=${month}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to load month schedule");

      setMonthDays(data.days || []);
      if (typeof data.firstDayOffset === "number") {
        setFirstDayOffset(data.firstDayOffset);
      } else if (data.days && data.days.length > 0) {
        const firstDate = new Date(`${data.days[0].date}T00:00:00.000Z`);
        setFirstDayOffset(firstDate.getUTCDay());
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load month schedule");
      setMonthDays([]);
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  useEffect(() => {
    if (viewMode === "day") {
      fetchDayData(selectedDate);
    } else if (viewMode === "week") {
      fetchWeekData(selectedDate);
    } else if (viewMode === "month") {
      fetchMonthData(selectedYear, selectedMonth);
    }
  }, [viewMode, selectedDate, selectedYear, selectedMonth, fetchDayData, fetchWeekData, fetchMonthData]);

  // Date Navigation handlers
  const handlePrev = () => {
    if (viewMode === "day") {
      const d = new Date(`${selectedDate}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 1);
      setSelectedDate(d.toISOString().split("T")[0]);
    } else if (viewMode === "week") {
      const d = new Date(`${selectedDate}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 7);
      setSelectedDate(d.toISOString().split("T")[0]);
    } else if (viewMode === "month") {
      if (selectedMonth === 1) {
        setSelectedMonth(12);
        setSelectedYear((y) => y - 1);
      } else {
        setSelectedMonth((m) => m - 1);
      }
    }
  };

  const handleNext = () => {
    if (viewMode === "day") {
      const d = new Date(`${selectedDate}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 1);
      setSelectedDate(d.toISOString().split("T")[0]);
    } else if (viewMode === "week") {
      const d = new Date(`${selectedDate}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() + 7);
      setSelectedDate(d.toISOString().split("T")[0]);
    } else if (viewMode === "month") {
      if (selectedMonth === 12) {
        setSelectedMonth(1);
        setSelectedYear((y) => y + 1);
      } else {
        setSelectedMonth((m) => m + 1);
      }
    }
  };

  const handleToday = () => {
    setSelectedDate(todayStr);
    const now = new Date();
    setSelectedYear(now.getFullYear());
    setSelectedMonth(now.getMonth() + 1);
  };

  const selectedDateLabel = useMemo(() => {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${selectedDate}T00:00:00.000Z`));
  }, [selectedDate]);

  const monthLabel = useMemo(() => {
    const d = new Date(Date.UTC(selectedYear, selectedMonth - 1, 1));
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(d);
  }, [selectedYear, selectedMonth]);

  // Slot Detail Modal
  const openSlotModal = (slot: SlotItem) => {
    setActiveSlot(slot);
    setStatusValue(slot.status);
    setModalOpen(true);
  };

  const handleStatusSave = async () => {
    if (!doctorId || !activeSlot) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/doctors/${doctorId}/slots`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slotId: activeSlot.id, status: statusValue }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d?.error || "Failed to update slot status");
      }
      showToast.success("Slot status updated");
      await fetchDayData(selectedDate);
      setModalOpen(false);
    } catch (err: any) {
      showToast.error(err?.message || "Failed to update slot");
    } finally {
      setSaving(false);
    }
  };

  // Group Day View into Booked Appointments vs Free Time Slots
  const bookedSlots = useMemo(() => {
    return daySlots.filter((s) => s.status === "BOOKED" || s.status === "HELD");
  }, [daySlots]);

  const freeBlocks = useMemo(() => {
    return timelineBlocks.filter((b) => b.type === "FREE");
  }, [timelineBlocks]);

  return (
    <div className="max-w-6xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <CalendarDays className="w-7 h-7 text-primary" />
            Doctor Schedule & Availability
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            View your booked appointments, manage free consultation slots, and review weekly hours
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Link href="/doctor/schedule/weeklySchedule">
            <Button size="sm" className="flex items-center gap-1.5 shadow-xs font-semibold">
              <CalendarDays className="w-4 h-4" />
              <span>Edit Weekly Schedule</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* View Switcher & Date Bar */}
      <Card className="border shadow-xs">
        <CardContent className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* View Mode Buttons */}
          <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border/40">
            <button
              onClick={() => setViewMode("day")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "day"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Day View</span>
            </button>
            <button
              onClick={() => setViewMode("week")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "week"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CalendarRange className="w-3.5 h-3.5" />
              <span>Week View</span>
            </button>
            <button
              onClick={() => setViewMode("month")}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                viewMode === "month"
                  ? "bg-background text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Month View</span>
            </button>
          </div>

          {/* Date Navigation */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={handlePrev}
              disabled={loading}
              title="Previous"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>

            {viewMode !== "month" ? (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className="h-8 text-xs font-semibold w-36 px-2 text-center"
                />
                <span className="text-sm font-semibold text-foreground hidden sm:inline">
                  {viewMode === "day" ? selectedDateLabel : `Week of ${selectedDate}`}
                </span>
              </div>
            ) : (
              <span className="text-sm font-semibold text-foreground px-3">
                {monthLabel}
              </span>
            )}

            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg"
              onClick={handleNext}
              disabled={loading}
              title="Next"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>

            <Button
              variant="secondary"
              size="sm"
              className="h-8 text-xs font-medium px-3 ml-1"
              onClick={handleToday}
              disabled={loading}
            >
              Today
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 1. DAY VIEW */}
      {/* ==================================================================== */}
      {viewMode === "day" && (
        <div className="space-y-6 animate-fadeIn">
          {/* Day Metrics Cards */}
          {dayMetrics && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="border shadow-2xs">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Booked Appointments</p>
                    <CheckCircle2 className="w-4 h-4 text-blue-500" />
                  </div>
                  <p className="text-2xl font-bold text-foreground mt-2">
                    {dayMetrics.bookedCount + dayMetrics.heldCount}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {formatMinutesToHours(dayMetrics.busyMinutes)} consultation time
                  </p>
                </CardContent>
              </Card>

              <Card className="border shadow-2xs">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Free Time Available</p>
                    <Clock className="w-4 h-4 text-emerald-500" />
                  </div>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-2">
                    {formatMinutesToHours(dayMetrics.freeMinutes)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {dayMetrics.availableCount} open consultation slots
                  </p>
                </CardContent>
              </Card>

              <Card className="border shadow-2xs">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Working Hours</p>
                    <CalendarDays className="w-4 h-4 text-slate-400" />
                  </div>
                  <p className="text-2xl font-bold text-foreground mt-2">
                    {formatMinutesToHours(dayMetrics.totalWorkingMinutes)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {dayMetrics.totalSlots} total generated slots
                  </p>
                </CardContent>
              </Card>

              <Card className="border shadow-2xs">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-muted-foreground">Day Status</p>
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <p className="text-lg font-bold text-foreground mt-2">
                    {dayMetrics.bookedCount + dayMetrics.heldCount === 0
                      ? "Free Whole Day"
                      : `${dayMetrics.occupancyPercentage}% Booked`}
                  </p>
                  <div className="w-full bg-muted rounded-full h-1.5 mt-1.5 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, dayMetrics.occupancyPercentage)}%` }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Section 1: Booked Appointments */}
          <Card className="border shadow-xs">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-blue-500" />
                    <span>Booked Appointments Today</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Patient consultations scheduled for {selectedDateLabel}
                  </CardDescription>
                </div>
                {bookedSlots.length > 0 && (
                  <Badge variant="secondary" className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200 font-bold">
                    {bookedSlots.length} Booked
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-4">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-16 w-full rounded-xl" />
                  <Skeleton className="h-16 w-full rounded-xl" />
                </div>
              ) : bookedSlots.length === 0 ? (
                <div className="py-8 text-center bg-emerald-50/40 dark:bg-emerald-950/15 rounded-xl border border-emerald-200/60 dark:border-emerald-800/40">
                  <Sparkles className="w-8 h-8 mx-auto text-emerald-500 mb-2 opacity-80" />
                  <p className="text-sm font-bold text-emerald-800 dark:text-emerald-300">
                    Free Whole Day
                  </p>
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-1">
                    No patient appointments are booked for this date. All working hours are open as free slots.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {bookedSlots.map((slot) => {
                    const patient = slot.appointment?.patient?.user;
                    const isHeld = slot.status === "HELD";

                    return (
                      <div
                        key={slot.id}
                        className="p-3.5 rounded-xl border bg-blue-50/50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800/70 flex flex-col justify-between gap-2.5 transition-all hover:shadow-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-bold text-foreground">
                                {formatTime(slot.startTime)} – {formatTime(slot.endTime)}
                              </span>
                              <Badge
                                variant="secondary"
                                className={`text-[10px] uppercase font-bold px-2 py-0.2 rounded-md ${
                                  isHeld
                                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200"
                                    : "bg-blue-200 text-blue-900 dark:bg-blue-900 dark:text-blue-200"
                                }`}
                              >
                                {isHeld ? "Held" : "Confirmed"}
                              </Badge>
                            </div>

                            <div className="mt-2 space-y-1">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                                <User className="w-3.5 h-3.5 text-primary" />
                                <span>{patient?.name || "Patient"}</span>
                                {patient?.gender && <span className="text-muted-foreground font-normal">({patient.gender})</span>}
                              </div>

                              {patient?.email && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Mail className="w-3 h-3" />
                                  <span>{patient.email}</span>
                                </div>
                              )}

                              {patient?.phoneNo && (
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  <Phone className="w-3 h-3" />
                                  <span>{patient.phoneNo}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>

                        {slot.appointment && (
                          <div className="pt-2 border-t border-blue-200/60 dark:border-blue-800/40 flex justify-end">
                            <Link
                              href={`/doctor/appointments/${slot.appointment.id}`}
                              className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                            >
                              <span>View Appointment Record</span>
                              <ArrowRight className="w-3 h-3" />
                            </Link>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 2: Free Time Slots (Open for Booking) */}
          <Card className="border shadow-xs">
            <CardHeader className="pb-3 border-b border-border/40">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-emerald-500" />
                    <span>Free Time Slots (Open for Consultations)</span>
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Continuous free windows where you have no booked appointments
                  </CardDescription>
                </div>
                {dayMetrics && (
                  <Badge variant="outline" className="text-xs font-semibold text-emerald-600 border-emerald-200">
                    {formatMinutesToHours(dayMetrics.freeMinutes)} Free Time
                  </Badge>
                )}
              </div>
            </CardHeader>

            <CardContent className="p-4">
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-14 w-full rounded-xl" />
                  <Skeleton className="h-14 w-full rounded-xl" />
                </div>
              ) : freeBlocks.length === 0 ? (
                <div className="py-6 text-center text-muted-foreground text-xs">
                  No open free slots available for this day.
                </div>
              ) : (
                <div className="space-y-2.5">
                  {freeBlocks.map((block, idx) => (
                    <div
                      key={idx}
                      className="p-3.5 rounded-xl border border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/50 dark:bg-emerald-950/15 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-2.5 h-8 rounded-full bg-emerald-500 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-foreground">
                              {formatTime(block.startTime)} – {formatTime(block.endTime)}
                            </span>
                            <Badge
                              variant="secondary"
                              className="text-[10px] uppercase font-bold px-2 py-0.2 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
                            >
                              Free Time
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Duration {formatMinutesToHours(block.durationMinutes)} • {block.slotCount} open 10-minute slots
                          </p>
                        </div>
                      </div>

                      <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold self-start sm:self-auto">
                        Available for Patient Bookings
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 3: Full Individual Slot Breakdown */}
          <Card className="border shadow-xs">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">All Day Slots Breakdown</CardTitle>
              <CardDescription className="text-xs">
                Click any slot if you wish to adjust its status manually
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full rounded-lg" />
                  <Skeleton className="h-12 w-full rounded-lg" />
                </div>
              ) : daySlots.length === 0 ? (
                <p className="text-sm text-center py-6 text-muted-foreground">
                  No slots generated for this day.
                </p>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                  {daySlots.map((slot) => {
                    const isBooked = slot.status === "BOOKED" || slot.status === "HELD";
                    return (
                      <div
                        key={slot.id}
                        onClick={() => openSlotModal(slot)}
                        className={`p-2 rounded-lg border text-center cursor-pointer transition-all hover:scale-[1.02] ${
                          statusTone[slot.status].bg
                        } ${statusTone[slot.status].border}`}
                      >
                        <p className="text-xs font-bold text-foreground">
                          {formatTime(slot.startTime)}
                        </p>
                        <p className="text-[10px] font-semibold opacity-80">
                          {isBooked ? "Booked" : slot.status === "AVAILABLE" ? "Free" : slot.status}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 2. WEEK VIEW */}
      {/* ==================================================================== */}
      {viewMode === "week" && (
        <div className="space-y-6 animate-fadeIn">
          {/* Week Summary Meter */}
          {weekMetrics && (
            <Card className="border shadow-xs bg-muted/20">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Week Summary</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {weekMetrics.totalBooked} Appointments Scheduled across {weekMetrics.totalSlots} Slots
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">Total Free Slots</p>
                    <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                      {weekMetrics.totalAvailable} slots
                    </p>
                  </div>
                  <div className="text-right border-l pl-4 border-border">
                    <p className="text-xs text-muted-foreground">Weekly Occupancy</p>
                    <p className="text-lg font-bold text-foreground">
                      {weekMetrics.occupancyRate}%
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* 7-Day Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-3">
            {loading ? (
              Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} className="h-64 w-full rounded-2xl" />
              ))
            ) : weekDays.length === 0 ? (
              <div className="col-span-full text-center py-10 text-muted-foreground">
                No schedule data found for this week.
              </div>
            ) : (
              weekDays.map((dayItem) => {
                const isToday = dayItem.date === todayStr;
                const isSelected = dayItem.date === selectedDate;
                const isFreeWholeDay = dayItem.bookedCount === 0;

                return (
                  <Card
                    key={dayItem.date}
                    className={`border transition-all hover:shadow-xs flex flex-col justify-between ${
                      isToday
                        ? "border-primary/60 bg-primary/5 dark:bg-primary/10"
                        : isSelected
                        ? "border-primary/40"
                        : "border-border"
                    }`}
                  >
                    <CardHeader className="p-3 pb-2 text-center border-b border-border/40">
                      <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                        {dayItem.dayName.slice(0, 3)}
                      </p>
                      <p className={`text-base font-bold ${isToday ? "text-primary" : "text-foreground"}`}>
                        {new Date(`${dayItem.date}T00:00:00.000Z`).getUTCDate()}
                      </p>
                      <p className="text-[10px] text-muted-foreground">{dayItem.date.slice(5)}</p>
                    </CardHeader>

                    <CardContent className="p-3 space-y-2.5 flex-1 flex flex-col justify-between">
                      <div className="space-y-2 text-xs">
                        {isFreeWholeDay ? (
                          <div className="py-2 text-center">
                            <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200 text-[10px] font-bold">
                              Free Whole Day
                            </Badge>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {dayItem.availableCount} Free Slots
                            </p>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Appointments:</span>
                              <span className="font-bold text-blue-600 dark:text-blue-400">
                                {dayItem.bookedCount}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-muted-foreground">Free Slots:</span>
                              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                                {dayItem.availableCount}
                              </span>
                            </div>
                          </>
                        )}

                        {/* Occupancy bar */}
                        <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden mt-1">
                          <div
                            className="bg-primary h-full rounded-full"
                            style={{ width: `${Math.min(100, dayItem.metrics?.occupancyPercentage || 0)}%` }}
                          />
                        </div>
                      </div>

                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full text-[11px] h-7 font-medium"
                        onClick={() => {
                          setSelectedDate(dayItem.date);
                          setViewMode("day");
                        }}
                      >
                        View Day
                      </Button>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* 3. MONTH VIEW */}
      {/* ==================================================================== */}
      {viewMode === "month" && (
        <Card className="border shadow-xs animate-fadeIn">
          <CardHeader className="pb-3 border-b border-border/40">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-base font-semibold">{monthLabel}</CardTitle>
                <CardDescription className="text-xs">
                  Monthly schedule overview showing booked appointments and free whole days
                </CardDescription>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-3 text-xs flex-wrap">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-muted-foreground">Free Whole Day</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                  <span className="text-muted-foreground">Booked Appointments</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500" />
                  <span className="text-muted-foreground">On Leave</span>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4">
            {/* Day of Week Headers */}
            <div className="grid grid-cols-7 gap-2 mb-2 text-center text-xs font-bold text-muted-foreground">
              <span>Sun</span>
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
            </div>

            {loading ? (
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 35 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full rounded-xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-7 gap-2">
                {/* Leading spacer cells for date-day alignment */}
                {Array.from({ length: firstDayOffset }).map((_, i) => (
                  <div
                    key={`empty-${i}`}
                    className="min-h-[82px] rounded-xl border border-dashed border-border/30 bg-muted/5 opacity-30"
                  />
                ))}

                {monthDays.map((dayItem) => {
                  const isToday = dayItem.date === todayStr;
                  const isLeave = dayItem.isLeave || dayItem.statusSummary === "ON_LEAVE";
                  const isBooked = dayItem.bookedCount > 0;

                  return (
                    <div
                      key={dayItem.date}
                      onClick={() => {
                        setSelectedDate(dayItem.date);
                        setViewMode("day");
                      }}
                      className={`min-h-[82px] p-2.5 rounded-xl border flex flex-col justify-between cursor-pointer transition-all hover:border-primary hover:shadow-xs ${
                        isToday
                          ? "bg-primary/5 border-primary/70 dark:bg-primary/10 ring-1 ring-primary/40"
                          : isLeave
                          ? "bg-purple-50/80 dark:bg-purple-950/20 border-purple-200 dark:border-purple-800"
                          : isBooked
                          ? "bg-blue-50/60 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800"
                          : "bg-emerald-50/40 dark:bg-emerald-950/15 border-emerald-200/70 dark:border-emerald-800/60"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`text-xs font-bold ${
                            isToday ? "text-primary font-extrabold" : "text-foreground"
                          }`}
                        >
                          {dayItem.dayNumber}
                        </span>
                        {isLeave ? (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 py-0 bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border-none font-bold"
                          >
                            Leave
                          </Badge>
                        ) : isBooked ? (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 py-0 bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200 border-none font-bold"
                          >
                            {dayItem.bookedCount} Booked
                          </Badge>
                        ) : (
                          <Badge
                            variant="secondary"
                            className="text-[9px] px-1.5 py-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border-none font-bold"
                          >
                            Free Whole Day
                          </Badge>
                        )}
                      </div>

                      <div className="space-y-0.5 text-[11px] font-medium">
                        {isLeave ? (
                          <p className="text-purple-700 dark:text-purple-300 text-[10px] font-semibold">
                            On Leave
                          </p>
                        ) : isBooked ? (
                          <div>
                            <p className="text-blue-700 dark:text-blue-300 font-bold truncate">
                              {dayItem.bookedCount} Appointment{dayItem.bookedCount > 1 ? "s" : ""}
                            </p>
                            {dayItem.availableCount > 0 && (
                              <p className="text-muted-foreground text-[10px] truncate">
                                +{dayItem.availableCount} free slots
                              </p>
                            )}
                          </div>
                        ) : (
                          <p className="text-emerald-700 dark:text-emerald-400 text-[10px] font-semibold">
                            {dayItem.availableCount > 0
                              ? `${dayItem.availableCount} Free Slots`
                              : "Whole Day Free"}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ==================================================================== */}
      {/* MODAL: Slot Status / Edit Details */}
      {/* ==================================================================== */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Slot Details</DialogTitle>
          </DialogHeader>

          {activeSlot && (
            <div className="space-y-4">
              <div className="p-3 rounded-xl bg-muted/50 border space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Time Window</p>
                <p className="text-base font-bold text-foreground">
                  {formatTime(activeSlot.startTime)} – {formatTime(activeSlot.endTime)}
                </p>
              </div>

              {activeSlot.appointment && (
                <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-1.5 text-xs">
                  <p className="font-bold text-blue-900 dark:text-blue-200 flex items-center gap-1.5">
                    <User className="w-3.5 h-3.5" />
                    <span>Patient Consultation</span>
                  </p>
                  <p className="text-foreground font-semibold">
                    {activeSlot.appointment.patient?.user?.name || "Patient"}
                  </p>
                  {activeSlot.appointment.patient?.user?.email && (
                    <p className="text-muted-foreground">{activeSlot.appointment.patient.user.email}</p>
                  )}
                  {activeSlot.appointment.patient?.user?.phoneNo && (
                    <p className="text-muted-foreground">Phone: {activeSlot.appointment.patient.user.phoneNo}</p>
                  )}
                  <Link
                    href={`/doctor/appointments/${activeSlot.appointment.id}`}
                    className="inline-block mt-1 text-primary font-bold hover:underline"
                  >
                    Open Appointment Record →
                  </Link>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground">Status</label>
                <select
                  value={statusValue}
                  onChange={(e) => setStatusValue(e.target.value as SlotStatus)}
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm focus:ring-2 focus:ring-primary focus:outline-none"
                >
                  <option value="AVAILABLE">AVAILABLE (Free Time Slot)</option>
                  <option value="UNAVAILABLE">UNAVAILABLE (Offline / Break)</option>
                  <option value="HELD">HELD (Temporarily reserved)</option>
                  <option value="BOOKED">BOOKED (Patient confirmed)</option>
                  <option value="CANCELLED">CANCELLED</option>
                  <option value="ON_LEAVE">ON_LEAVE</option>
                </select>
              </div>
            </div>
          )}

          <DialogFooter className="flex flex-row justify-end items-center gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outline" size="sm" className="text-xs">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              size="sm"
              onClick={handleStatusSave}
              disabled={saving}
              className="text-xs font-semibold"
            >
              {saving ? "Saving..." : "Save Status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
