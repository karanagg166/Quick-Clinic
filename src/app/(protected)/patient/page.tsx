"use client";

import Link from "next/link";
import { CalendarDays, UserPlus, MessageCircle, FileText, Stethoscope, HeartPulse, Clock3 } from "lucide-react";
import { useUserStore } from "@/store/userStore";
import UpcomingAppointmentsSection from "@/components/patient/upcomingAppointmentsSection";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function PatientDashboard() {
  const { user } = useUserStore();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <Card className="bg-gradient-to-r from-emerald-600 to-emerald-500 text-white border-0">
        <CardContent className="p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <p className="text-sm opacity-80">Welcome back</p>
              <h1 className="text-3xl font-bold leading-tight">{user?.name || "Patient"}</h1>
              <p className="text-sm opacity-80 mt-1">Track your health, appointments, and care in one place.</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="secondary" size="sm" className="bg-white/10 hover:bg-white/20 text-white border-0">
                <Link href="/patient/doctor">
                  <Stethoscope className="w-4 h-4 mr-2" /> Find Doctors
                </Link>
              </Button>
              <Button asChild size="sm" className="bg-white text-emerald-600 hover:bg-emerald-50">
                <Link href="/patient/appointments">
                  <CalendarDays className="w-4 h-4 mr-2" /> View Appointments
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Upcoming Appointments", value: "--", icon: CalendarDays, tone: "emerald" },
          { label: "Assigned Doctors", value: "--", icon: Stethoscope, tone: "blue" },
          { label: "Pending Approvals", value: "--", icon: Clock3, tone: "amber" },
          { label: "Wellness Score", value: "--", icon: HeartPulse, tone: "rose" },
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
        {/* Upcoming section */}
        <div className="xl:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Upcoming Appointments</CardTitle>
                  <CardDescription>Your scheduled visits and follow-ups</CardDescription>
                </div>
                <Button asChild variant="link" className="h-auto p-0">
                  <Link href="/patient/appointments">View all</Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <UpcomingAppointmentsSection />
            </CardContent>
          </Card>
        </div>

        {/* Quick actions / recent activity */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Button asChild variant="ghost" className="w-full justify-start">
                <Link href="/patient/doctor">
                  <UserPlus className="w-5 h-5 mr-3 text-blue-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Find a doctor</p>
                    <p className="text-xs text-muted-foreground">Browse specializations and availability</p>
                  </div>
                </Link>
              </Button>
              <Button asChild variant="ghost" className="w-full justify-start">
                <Link href="/patient/chat">
                  <MessageCircle className="w-5 h-5 mr-3 text-emerald-600" />
                  <div className="text-left">
                    <p className="font-medium text-sm">Open chat</p>
                    <p className="text-xs text-muted-foreground">Message your doctor</p>
                  </div>
                </Link>
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {["Appointment confirmed", "Prescription added", "Lab results updated"].map((item) => (
                <div key={item} className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition">
                  <FileText className="w-5 h-5 text-emerald-600" />
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
