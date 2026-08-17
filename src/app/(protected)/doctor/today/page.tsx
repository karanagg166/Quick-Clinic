"use client";

import { useEffect, useState, useCallback } from "react";
import { useUserStore } from "@/store/userStore";
import type { DoctorAppointment } from "@/types/doctor";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import StatusBadge from "@/components/general/StatusBadge";
import { showToast } from "@/lib/toast";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  UserX,
  MessageSquare,
  Clock,
  User,
  Phone,
  MapPin,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Sparkles,
  Search,
} from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";

export default function DoctorTodayAppointmentsPage() {
  const doctorId = useUserStore((s) => s.doctorId);
  const user = useUserStore((s) => s.user);

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    const now = new Date();
    return now.toISOString().split("T")[0];
  });

  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("ALL");

  const fetchTodayAppointments = useCallback(async () => {
    if (!doctorId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        doctorId,
        startDate: selectedDate,
        endDate: selectedDate,
      });

      const res = await fetch(`/api/doctors/${doctorId}/appointments?${params.toString()}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setAppointments(data);
      } else {
        setAppointments([]);
      }
    } catch (err) {
      console.error("Failed to load today's appointments", err);
      showToast.error("Failed to load today's schedule");
    } finally {
      setLoading(false);
    }
  }, [doctorId, selectedDate]);

  useEffect(() => {
    fetchTodayAppointments();
  }, [fetchTodayAppointments]);

  const handleUpdateStatus = async (
    appointmentId: string,
    newStatus: "COMPLETED" | "NO_SHOW" | "CANCELLED"
  ) => {
    if (!doctorId) return;
    setUpdatingId(appointmentId);

    try {
      const res = await fetch(`/api/doctors/${doctorId}/appointments/${appointmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update appointment");
      }

      setAppointments((prev) =>
        prev.map((appt) =>
          appt.id === appointmentId ? { ...appt, status: newStatus } : appt
        )
      );

      if (newStatus === "COMPLETED") {
        showToast.success("Consultation completed! Rating prompt sent to patient's chat.");
      } else if (newStatus === "NO_SHOW") {
        showToast.info("Marked as No Show. Rebook invitation sent to patient's chat.");
      } else if (newStatus === "CANCELLED") {
        showToast.warning("Appointment cancelled and slot released.");
      }
    } catch (err: any) {
      showToast.error(err.message || "Failed to update appointment");
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDateChange = (daysOffset: number) => {
    const current = new Date(selectedDate);
    current.setDate(current.getDate() + daysOffset);
    setSelectedDate(current.toISOString().split("T")[0]);
  };

  const handleResetToToday = () => {
    const today = new Date().toISOString().split("T")[0];
    setSelectedDate(today);
  };

  const isToday = selectedDate === new Date().toISOString().split("T")[0];

  // Stats calculation
  const totalCount = appointments.length;
  const confirmedCount = appointments.filter((a) => a.status === "CONFIRMED").length;
  const completedCount = appointments.filter((a) => a.status === "COMPLETED").length;
  const noShowCount = appointments.filter((a) => a.status === "NO_SHOW").length;
  const cancelledCount = appointments.filter((a) => a.status === "CANCELLED" || a.status === "EXPIRED").length;

  const filteredAppointments = appointments.filter((appt) => {
    const matchesSearch =
      searchQuery === "" ||
      appt.patientName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      appt.patientString.toLowerCase().includes(searchQuery.toLowerCase()) ||
      appt.city.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = filterStatus === "ALL" || appt.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const formattedDateTitle = new Date(selectedDate + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-6 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-card p-6 rounded-2xl border shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
              Day Schedule & Consultations
            </h1>
            {isToday && (
              <Badge variant="default" className="bg-emerald-600 text-white gap-1 text-xs">
                <Sparkles className="w-3 h-3" /> Today
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm mt-1">
            Manage your daily clinic patient queue, complete consultations, and record patient attendance.
          </p>
        </div>

        {/* Date Selector Navigation */}
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="icon"
            onClick={() => handleDateChange(-1)}
            title="Previous Day"
            className="rounded-xl"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>

          <div className="flex items-center gap-2 bg-muted px-3 py-1.5 rounded-xl border">
            <CalendarIcon className="w-4 h-4 text-primary" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
              className="bg-transparent text-sm font-medium text-foreground outline-none cursor-pointer"
            />
          </div>

          <Button
            variant="outline"
            size="icon"
            onClick={() => handleDateChange(1)}
            title="Next Day"
            className="rounded-xl"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>

          {!isToday && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleResetToToday}
              className="gap-1.5 rounded-xl text-xs font-medium"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Back to Today
            </Button>
          )}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <Card
          onClick={() => setFilterStatus("ALL")}
          className={`cursor-pointer transition-all hover:border-primary/50 ${
            filterStatus === "ALL" ? "border-primary ring-2 ring-primary/20 bg-primary/5" : ""
          }`}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Total Bookings</p>
              <p className="text-2xl font-bold mt-0.5">{totalCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center text-muted-foreground font-semibold">
              {totalCount}
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => setFilterStatus("CONFIRMED")}
          className={`cursor-pointer transition-all hover:border-emerald-500/50 ${
            filterStatus === "CONFIRMED" ? "border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-500/5" : ""
          }`}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Confirmed / Due</p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">{confirmedCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold">
              {confirmedCount}
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => setFilterStatus("COMPLETED")}
          className={`cursor-pointer transition-all hover:border-blue-500/50 ${
            filterStatus === "COMPLETED" ? "border-blue-500 ring-2 ring-blue-500/20 bg-blue-500/5" : ""
          }`}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-blue-700 dark:text-blue-400">Completed</p>
              <p className="text-2xl font-bold text-blue-700 dark:text-blue-400 mt-0.5">{completedCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center font-bold">
              {completedCount}
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => setFilterStatus("NO_SHOW")}
          className={`cursor-pointer transition-all hover:border-orange-500/50 ${
            filterStatus === "NO_SHOW" ? "border-orange-500 ring-2 ring-orange-500/20 bg-orange-500/5" : ""
          }`}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-orange-700 dark:text-orange-400">Never Showed Up</p>
              <p className="text-2xl font-bold text-orange-700 dark:text-orange-400 mt-0.5">{noShowCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-600 flex items-center justify-center font-bold">
              {noShowCount}
            </div>
          </CardContent>
        </Card>

        <Card
          onClick={() => setFilterStatus("CANCELLED")}
          className={`cursor-pointer transition-all hover:border-rose-500/50 ${
            filterStatus === "CANCELLED" ? "border-rose-500 ring-2 ring-rose-500/20 bg-rose-500/5" : ""
          }`}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-medium text-rose-700 dark:text-rose-400">Cancelled / Expired</p>
              <p className="text-2xl font-bold text-rose-700 dark:text-rose-400 mt-0.5">{cancelledCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center font-bold">
              {cancelledCount}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            placeholder="Search patient name, email, city..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 rounded-xl text-sm"
          />
        </div>

        <div className="text-xs text-muted-foreground font-medium">
          Showing {filteredAppointments.length} of {totalCount} consultations for{" "}
          <span className="font-semibold text-foreground">{formattedDateTitle}</span>
        </div>
      </div>

      {/* Appointment Queue List */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-36 w-full rounded-2xl" />
            ))}
          </div>
        ) : filteredAppointments.length === 0 ? (
          <Card className="rounded-2xl border-dashed">
            <CardContent className="p-12 text-center space-y-3">
              <div className="w-14 h-14 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                <CalendarIcon className="w-7 h-7" />
              </div>
              <h3 className="text-lg font-semibold text-foreground">No Appointments Found</h3>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {totalCount === 0
                  ? `There are no scheduled patient appointments on ${formattedDateTitle}.`
                  : `No appointments match your filter (${filterStatus}) or search.`}
              </p>
              {filterStatus !== "ALL" && (
                <Button variant="outline" size="sm" onClick={() => setFilterStatus("ALL")} className="rounded-xl mt-2">
                  Clear Status Filter
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          filteredAppointments.map((appt) => {
            const timeString = appt.appointmentTime
              ? new Date(appt.appointmentTime).toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  timeZone: "UTC",
                })
              : "N/A";

            const isUpdating = updatingId === appt.id;

            return (
              <Card
                key={appt.id}
                className="rounded-2xl border transition-all hover:shadow-md overflow-hidden bg-card"
              >
                <CardContent className="p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
                  {/* Patient & Slot Info */}
                  <div className="space-y-3 flex-1">
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0">
                        {appt.patientName?.charAt(0)?.toUpperCase() || "P"}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="text-base font-bold text-foreground">{appt.patientName}</h3>
                          <StatusBadge status={appt.status} />
                        </div>
                        <p className="text-xs text-muted-foreground">{appt.patientString}</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg">
                        <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
                        <span className="font-semibold text-foreground">{timeString}</span>
                      </div>

                      <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg">
                        <User className="w-3.5 h-3.5 shrink-0" />
                        <span>
                          {appt.gender || "N/A"} • {appt.age || "N/A"} yrs
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg">
                        <MapPin className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{appt.city || "Clinic"}</span>
                      </div>

                      <div className="flex items-center gap-1.5 bg-muted/50 px-2.5 py-1.5 rounded-lg">
                        <CreditCard className="w-3.5 h-3.5 shrink-0" />
                        <span>{appt.paymentMethod === "ONLINE" ? "Paid Online" : "Pay at Clinic"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-wrap md:flex-nowrap shrink-0 border-t md:border-t-0 pt-3 md:pt-0">
                    <Link href={`/doctor/chat`}>
                      <Button variant="outline" size="sm" className="rounded-xl gap-1.5 text-xs">
                        <MessageSquare className="w-3.5 h-3.5 text-primary" /> Chat
                      </Button>
                    </Link>

                    {appt.status === "CONFIRMED" && (
                      <>
                        <Button
                          variant="default"
                          size="sm"
                          disabled={isUpdating}
                          onClick={() => handleUpdateStatus(appt.id, "COMPLETED")}
                          className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-1.5 text-xs font-semibold shadow-xs"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {isUpdating ? "Updating..." : "Mark Completed"}
                        </Button>

                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isUpdating}
                          onClick={() => handleUpdateStatus(appt.id, "NO_SHOW")}
                          className="border-orange-500/40 text-orange-700 dark:text-orange-400 hover:bg-orange-500/10 rounded-xl gap-1.5 text-xs"
                        >
                          <UserX className="w-3.5 h-3.5" />
                          Mark No Show
                        </Button>
                      </>
                    )}

                    {appt.status === "PENDING" && (
                      <Button
                        variant="default"
                        size="sm"
                        disabled={isUpdating}
                        onClick={() => handleUpdateStatus(appt.id, "COMPLETED")}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl gap-1.5 text-xs font-semibold"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Mark Completed
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
