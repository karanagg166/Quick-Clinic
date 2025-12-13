"use client";

import Link from "next/link";
import { CalendarDays, UserPlus, MessageCircle, FileText, Stethoscope, HeartPulse, Clock3 } from "lucide-react";
import { useUserStore } from "@/store/userStore";
import UpcomingAppointmentsSection from "@/components/patient/upcomingAppointmentsSection";

export default function PatientDashboard() {
  const { user } = useUserStore();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="bg-linear-to-r from-emerald-600 to-emerald-500 text-white rounded-2xl p-6 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-sm opacity-80">Welcome back</p>
            <h1 className="text-3xl font-bold leading-tight">{user?.name || "Patient"}</h1>
            <p className="text-sm opacity-80 mt-1">Track your health, appointments, and care in one place.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/patient/doctor" className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
              <Stethoscope className="w-4 h-4" /> Find Doctors
            </Link>
            <Link href="/patient/appointments" className="inline-flex items-center gap-2 bg-white text-emerald-600 hover:bg-emerald-50 px-4 py-2 rounded-lg text-sm font-semibold transition">
              <CalendarDays className="w-4 h-4" /> View Appointments
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Upcoming Appointments", value: "--", icon: CalendarDays, tone: "emerald" },
          { label: "Assigned Doctors", value: "--", icon: Stethoscope, tone: "blue" },
          { label: "Pending Approvals", value: "--", icon: Clock3, tone: "amber" },
          { label: "Wellness Score", value: "--", icon: HeartPulse, tone: "rose" },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl shadow-sm p-5 border border-gray-100 flex items-start gap-3">
            <div className={`p-2.5 rounded-lg bg-${card.tone}-50 text-${card.tone}-600`}>
              <card.icon className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-gray-500">{card.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
              <p className="text-xs text-gray-500">Live metrics coming soon</p>
            </div>
          </div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Upcoming section */}
        <div className="xl:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Upcoming Appointments</h3>
                <p className="text-sm text-gray-500">Your scheduled visits and follow-ups</p>
              </div>
              <Link href="/patient/appointments" className="text-sm font-semibold text-emerald-600 hover:text-emerald-700">View all</Link>
            </div>
            <UpcomingAppointmentsSection />
          </div>
        </div>

        {/* Quick actions / recent activity */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <Link href="/patient/doctor" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                <UserPlus className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">Find a doctor</p>
                  <p className="text-xs text-gray-500">Browse specializations and availability</p>
                </div>
              </Link>
              <Link href="/patient/chat" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                <MessageCircle className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">Open chat</p>
                  <p className="text-xs text-gray-500">Message your doctor</p>
                </div>
              </Link>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Recent Activity</h3>
            <div className="space-y-2 text-sm text-gray-700">
              {["Appointment confirmed", "Prescription added", "Lab results updated"].map((item) => (
                <div key={item} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                  <FileText className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="font-medium text-gray-900 text-sm">{item}</p>
                    <p className="text-xs text-gray-500">Just now</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
