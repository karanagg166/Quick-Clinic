'use client';

import Link from "next/link";
import { CalendarDays, Users, Wallet, Clock3, PlusCircle, MessageCircle, FileText } from "lucide-react";
import { useUserStore } from "@/store/userStore";
import TodaysAppointmentSection from "@/components/doctor/todaysAppointmentSection";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function DoctorDashboard() {
  const { user, doctorId } = useUserStore();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <Card className="bg-gradient-to-r from-blue-600 to-blue-500 text-white border-0">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm opacity-80">Welcome back</p>
              <h1 className="text-3xl font-bold leading-tight">{user?.name || "Doctor"}</h1>
              <p className="text-sm opacity-80 mt-1">Manage your day, patients, and earnings in one place.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="secondary" size="sm" className="bg-white/10 hover:bg-white/20 text-white border-0">
                <Link href="/doctor/schedule">
                  <CalendarDays className="w-4 h-4 mr-2" /> View Schedule
                </Link>
              </Button>
              <Button asChild size="sm" className="bg-white text-blue-600 hover:bg-blue-50">
                <Link href="/doctor/appointments">
                  <PlusCircle className="w-4 h-4 mr-2" /> Create Slot
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Today's Appointments", value: "--", icon: CalendarDays, tone: "blue" },
          { label: "Active Patients", value: "--", icon: Users, tone: "emerald" },
          { label: "Pending Consults", value: "--", icon: Clock3, tone: "amber" },
          { label: "This Month's Earnings", value: "--", icon: Wallet, tone: "indigo" },
        ].map((card) => (
          <Card key={card.label}>
            <CardContent className="p-5 flex items-start gap-3">
              <div className={`p-2.5 rounded-lg bg-${card.tone}-50 text-${card.tone}-600`}>
                <card.icon className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{card.label}</p>
                <p className="text-2xl font-bold mt-1">{card.value}</p>
                <p className="text-xs text-muted-foreground">Live metrics coming soon</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Today section */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Today's Appointments</CardTitle>
                  <CardDescription>See who you are meeting today</CardDescription>
                </div>
                <Button asChild variant="link" className="h-auto p-0">
                  <Link href="/doctor/appointments">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {doctorId ? (
                <TodaysAppointmentSection doctorId={doctorId} />
              ) : (
                <div className="text-muted-foreground text-sm">No doctor ID found. Please log in again.</div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick actions / recent items */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button asChild variant="ghost" className="w-full justify-start">
                <Link href="/doctor/schedule">
                  <CalendarDays className="w-5 h-5 mr-3 text-blue-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Manage schedule</p>
                    <p className="text-xs text-muted-foreground">Update availability and slots</p>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="ghost" className="w-full justify-start">
                <Link href="/doctor/chat">
                  <MessageCircle className="w-5 h-5 mr-3 text-emerald-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Open chat</p>
                    <p className="text-xs text-muted-foreground">Message patients directly</p>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="ghost" className="w-full justify-start">
                <Link href="/doctor/leave">
                  <Clock3 className="w-5 h-5 mr-3 text-amber-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Request leave</p>
                    <p className="text-xs text-muted-foreground">Plan time off</p>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="ghost" className="w-full justify-start">
                <Link href="/doctor/earnings">
                  <Wallet className="w-5 h-5 mr-3 text-indigo-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Earnings</p>
                    <p className="text-xs text-muted-foreground">Track payouts and history</p>
                  </div>
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Documents</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {["Lab report upload", "Prescription updated", "Follow-up note"].map((item) => (
                <div key={item} className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition">
                  <FileText className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="font-medium text-sm">{item}</p>
                    <p className="text-xs text-muted-foreground">Just now</p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
