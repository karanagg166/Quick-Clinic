import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  calculateTimelineBlocks,
  calculateDayMetrics,
  RawSlot,
} from "@/lib/scheduleUtils";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ doctorId: string }> }
) {
  try {
    const { doctorId } = await params;
    if (!doctorId) {
      return NextResponse.json({ error: "Missing doctorId" }, { status: 400 });
    }

    const { searchParams } = req.nextUrl;
    const view = searchParams.get("view") || "day";

    // ----------------------------------------------------
    // VIEW 1: DAY VIEW
    // ----------------------------------------------------
    if (view === "day") {
      const dateStr = searchParams.get("date") || new Date().toISOString().split("T")[0];
      const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
      const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

      if (isNaN(startOfDay.getTime())) {
        return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
      }

      // Check if slots exist for this day; if not, query via slots logic
      let slots: any[] = await prisma.slot.findMany({
        where: {
          doctorId,
          date: startOfDay,
        },
        include: {
          appointment: {
            include: {
              patient: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                      phoneNo: true,
                      gender: true,
                      age: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { startTime: "asc" },
      });

      // If no slots exist yet for the day, attempt to trigger auto-generation from weekly schedule
      if (slots.length === 0) {
        const schedule = await prisma.schedule.findUnique({
          where: { doctorId },
        });

        if (schedule && schedule.weeklySchedule) {
          const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
          const dayName = daysOfWeek[startOfDay.getUTCDay()];
          const weeklySchedule = schedule.weeklySchedule as Array<{
            day: string;
            slots: Array<{ slotNo: number; start: string; end: string }>;
          }>;

          const daySchedule = weeklySchedule.find((d) => d.day === dayName);

          if (daySchedule && daySchedule.slots && daySchedule.slots.length > 0) {
            const activeLeaves = await prisma.leave.findMany({
              where: {
                doctorId,
                startDate: { lte: endOfDay },
                endDate: { gte: startOfDay },
              },
            });

            for (const timeSlot of daySchedule.slots) {
              if (!timeSlot.start || !timeSlot.end) continue;
              const [sH, sM] = timeSlot.start.split(":").map(Number);
              const [eH, eM] = timeSlot.end.split(":").map(Number);
              const startMin = sH * 60 + sM;
              const endMin = eH * 60 + eM;

              for (let min = startMin; min < endMin; min += 10) {
                const startTime = new Date(startOfDay);
                startTime.setUTCHours(Math.floor(min / 60), min % 60, 0, 0);

                const endTime = new Date(startTime);
                endTime.setUTCMinutes(endTime.getUTCMinutes() + 10);

                const isOnLeave = activeLeaves.some(
                  (leave: { startDate: Date; endDate: Date }) =>
                    startTime < leave.endDate && endTime > leave.startDate
                );

                await prisma.slot.create({
                  data: {
                    doctorId,
                    date: startOfDay,
                    startTime,
                    endTime,
                    status: isOnLeave ? "ON_LEAVE" : "AVAILABLE",
                  },
                });
              }
            }

            // Re-query newly created slots
            slots = await prisma.slot.findMany({
              where: { doctorId, date: startOfDay },
              include: {
                appointment: {
                  include: {
                    patient: {
                      include: {
                        user: {
                          select: {
                            id: true,
                            name: true,
                            email: true,
                            phoneNo: true,
                            gender: true,
                            age: true,
                          },
                        },
                      },
                    },
                  },
                },
              },
              orderBy: { startTime: "asc" },
            });
          }
        }
      }

      const rawSlots: RawSlot[] = slots.map((s: any) => ({
        id: s.id,
        startTime: s.startTime,
        endTime: s.endTime,
        status: s.status as any,
        appointment: s.appointment
          ? {
              id: s.appointment.id,
              status: s.appointment.status,
              patient: {
                user: s.appointment.patient?.user
                  ? {
                      name: s.appointment.patient.user.name,
                      email: s.appointment.patient.user.email,
                      phoneNo: s.appointment.patient.user.phoneNo,
                    }
                  : undefined,
              },
            }
          : null,
      }));

      const timelineBlocks = calculateTimelineBlocks(rawSlots);
      const metrics = calculateDayMetrics(rawSlots);

      return NextResponse.json(
        {
          view: "day",
          date: dateStr,
          slots,
          timelineBlocks,
          metrics,
        },
        { status: 200 }
      );
    }

    // ----------------------------------------------------
    // VIEW 2: WEEK VIEW
    // ----------------------------------------------------
    if (view === "week") {
      let startDateStr = searchParams.get("startDate");

      if (!startDateStr) {
        // Default to current week's Monday
        const now = new Date();
        const day = now.getUTCDay();
        const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(now.setUTCDate(diff));
        startDateStr = monday.toISOString().split("T")[0];
      }

      const weekStart = new Date(`${startDateStr}T00:00:00.000Z`);
      const weekEnd = new Date(weekStart);
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 7);

      const slots: any[] = await prisma.slot.findMany({
        where: {
          doctorId,
          date: {
            gte: weekStart,
            lt: weekEnd,
          },
        },
        include: {
          appointment: {
            include: {
              patient: {
                include: {
                  user: {
                    select: {
                      id: true,
                      name: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { startTime: "asc" },
      });

      // Group slots by 7 days
      const days = [];
      const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      for (let i = 0; i < 7; i++) {
        const curDate = new Date(weekStart);
        curDate.setUTCDate(curDate.getUTCDate() + i);
        const curDateStr = curDate.toISOString().split("T")[0];

        const daySlots = slots.filter((s: any) => {
          const slotDateStr = new Date(s.date).toISOString().split("T")[0];
          return slotDateStr === curDateStr;
        });

        const rawSlots: RawSlot[] = daySlots.map((s: any) => ({
          id: s.id,
          startTime: s.startTime,
          endTime: s.endTime,
          status: s.status as any,
          appointment: s.appointment
            ? {
                id: s.appointment.id,
                status: s.appointment.status,
                patient: {
                  user: s.appointment.patient?.user
                    ? {
                        name: s.appointment.patient.user.name,
                        email: s.appointment.patient.user.email,
                      }
                    : undefined,
                },
              }
            : null,
        }));

        const dayMetrics = calculateDayMetrics(rawSlots);
        const timelineBlocks = calculateTimelineBlocks(rawSlots);

        days.push({
          date: curDateStr,
          dayName: daysOfWeek[curDate.getUTCDay()],
          metrics: dayMetrics,
          timelineBlocks,
          slotsCount: daySlots.length,
          bookedCount: dayMetrics.bookedCount + dayMetrics.heldCount,
          availableCount: dayMetrics.availableCount,
        });
      }

      // Aggregate overall week metrics
      const totalSlots = days.reduce((acc, d) => acc + d.metrics.totalSlots, 0);
      const totalBooked = days.reduce((acc, d) => acc + d.bookedCount, 0);
      const totalAvailable = days.reduce((acc, d) => acc + d.availableCount, 0);

      return NextResponse.json(
        {
          view: "week",
          startDate: startDateStr,
          days,
          weekMetrics: {
            totalSlots,
            totalBooked,
            totalAvailable,
            occupancyRate: totalSlots > 0 ? Math.round((totalBooked / totalSlots) * 100) : 0,
          },
        },
        { status: 200 }
      );
    }

    // ----------------------------------------------------
    // VIEW 3: MONTH VIEW
    // ----------------------------------------------------
    if (view === "month") {
      const now = new Date();
      const year = parseInt(searchParams.get("year") || `${now.getUTCFullYear()}`, 10);
      const month = parseInt(searchParams.get("month") || `${now.getUTCMonth() + 1}`, 10); // 1-12

      const startOfMonth = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
      const endOfMonth = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
      const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

      const [slots, leaves] = await Promise.all([
        prisma.slot.findMany({
          where: {
            doctorId,
            date: {
              gte: startOfMonth,
              lte: endOfMonth,
            },
          },
          select: {
            id: true,
            date: true,
            status: true,
          },
        }),
        prisma.leave.findMany({
          where: {
            doctorId,
            startDate: { lte: endOfMonth },
            endDate: { gte: startOfMonth },
          },
        }),
      ]);

      const days = [];
      const daysOfWeek = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

      const firstDayOffset = startOfMonth.getUTCDay();

      for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
        const dateObj = new Date(Date.UTC(year, month - 1, dayNum));
        const dateStr = dateObj.toISOString().split("T")[0];

        const daySlots = slots.filter((s: { date: Date | string }) => {
          const slotDateStr = new Date(s.date).toISOString().split("T")[0];
          return slotDateStr === dateStr;
        });

        const bookedCount = daySlots.filter((s: { status: string }) => s.status === "BOOKED" || s.status === "HELD").length;
        const availableCount = daySlots.filter((s: { status: string }) => s.status === "AVAILABLE").length;
        const unavailableCount = daySlots.filter((s: { status: string }) => s.status === "UNAVAILABLE" || s.status === "CANCELLED").length;

        const isLeave = leaves.some(
          (leave: { startDate: Date | string; endDate: Date | string }) =>
            dateObj >= new Date(leave.startDate) && dateObj <= new Date(leave.endDate)
        );

        let statusSummary: "ON_LEAVE" | "BOOKED" | "FREE_WHOLE_DAY" = "FREE_WHOLE_DAY";
        if (isLeave) {
          statusSummary = "ON_LEAVE";
        } else if (bookedCount > 0) {
          statusSummary = "BOOKED";
        } else {
          statusSummary = "FREE_WHOLE_DAY";
        }

        days.push({
          date: dateStr,
          dayNumber: dayNum,
          dayName: daysOfWeek[dateObj.getUTCDay()],
          dayOfWeek: dateObj.getUTCDay(),
          totalSlots: daySlots.length,
          bookedCount,
          availableCount,
          unavailableCount,
          isLeave,
          statusSummary,
          occupancyRate: daySlots.length > 0 ? Math.round((bookedCount / daySlots.length) * 100) : 0,
        });
      }

      return NextResponse.json(
        {
          view: "month",
          year,
          month,
          daysInMonth,
          firstDayOffset,
          days,
        },
        { status: 200 }
      );
    }

    return NextResponse.json({ error: "Invalid view parameter (expected 'day', 'week', or 'month')" }, { status: 400 });
  } catch (err: any) {
    console.error("Doctor schedule overview error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error fetching schedule overview" },
      { status: 500 }
    );
  }
}
