'use client';

import Link from "next/link";
import { CalendarDays, Users, Wallet, Clock3, PlusCircle, MessageCircle, FileText } from "lucide-react";
import { useUserStore } from "@/store/userStore";
import TodaysAppointmentSection from "@/components/doctor/todaysAppointmentSection";

export default function DoctorDashboard() {
  const { user, doctorId } = useUserStore();

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="bg-linear-to-r from-blue-600 to-blue-500 text-white rounded-2xl p-6 shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <p className="text-sm opacity-80">Welcome back</p>
            <h1 className="text-3xl font-bold leading-tight">{user?.name || "Doctor"}</h1>
            <p className="text-sm opacity-80 mt-1">Manage your day, patients, and earnings in one place.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/doctor/schedule" className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg text-sm font-medium transition">
              <CalendarDays className="w-4 h-4" /> View Schedule
            </Link>
            <Link href="/doctor/appointments" className="inline-flex items-center gap-2 bg-white text-blue-600 hover:bg-blue-50 px-4 py-2 rounded-lg text-sm font-semibold transition">
              <PlusCircle className="w-4 h-4" /> Create Slot
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          { label: "Today's Appointments", value: "--", icon: CalendarDays, tone: "blue" },
          { label: "Active Patients", value: "--", icon: Users, tone: "emerald" },
          { label: "Pending Consults", value: "--", icon: Clock3, tone: "amber" },
          { label: "This Month's Earnings", value: "--", icon: Wallet, tone: "indigo" },
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
        {/* Today section */}
        <div className="xl:col-span-2">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-gray-900">Today's Appointments</h3>
                <p className="text-sm text-gray-500">See who you are meeting today</p>
              </div>
              <Link href="/doctor/appointments" className="text-sm font-semibold text-blue-600 hover:text-blue-700">View all</Link>
            </div>
            {doctorId ? (
              <TodaysAppointmentSection doctorId={doctorId} />
            ) : (
              <div className="text-gray-500 text-sm">No doctor ID found. Please log in again.</div>
            )}
          </div>
        </div>

        {/* Quick actions / recent items */}
        <div className="space-y-6">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Quick Actions</h3>
            <div className="space-y-2">
              <Link href="/doctor/schedule" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                <CalendarDays className="w-5 h-5 text-blue-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">Manage schedule</p>
                  <p className="text-xs text-gray-500">Update availability and slots</p>
                </div>
              </Link>
              <Link href="/doctor/chat" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                <MessageCircle className="w-5 h-5 text-emerald-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">Open chat</p>
                  <p className="text-xs text-gray-500">Message patients directly</p>
                </div>
              </Link>
              <Link href="/doctor/leave" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                <Clock3 className="w-5 h-5 text-amber-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">Request leave</p>
                  <p className="text-xs text-gray-500">Plan time off</p>
                </div>
              </Link>
              <Link href="/doctor/earnings" className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                <Wallet className="w-5 h-5 text-indigo-600" />
                <div>
                  <p className="font-medium text-gray-900 text-sm">Earnings</p>
                  <p className="text-xs text-gray-500">Track payouts and history</p>
                </div>
              </Link>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <h3 className="text-lg font-semibold text-gray-900 mb-3">Recent Documents</h3>
            <div className="space-y-2 text-sm text-gray-700">
              {["Lab report upload", "Prescription updated", "Follow-up note"].map((item) => (
                <div key={item} className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition">
                  <FileText className="w-5 h-5 text-blue-600" />
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
