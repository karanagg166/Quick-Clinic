'use client';

import Link from 'next/link';
import { Bell, User, LogOut, Menu, CalendarDays, ClipboardList, Users, Wallet } from 'lucide-react';

interface DoctorNavbarProps {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export default function DoctorNavbar({ isSidebarOpen, setSidebarOpen }: DoctorNavbarProps) {
  return (
    <nav className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">

      {/* LEFT SECTION — Logo + Sidebar Toggle + Nav Links */}
      <div className="flex items-center gap-8">
        
        {/* Menu Button */}
        <button
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        {/* Logo */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-lg">Q</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900">QuickClinic</h1>
        </div>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-6">

          <Link
            href="/doctorDashboard"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <CalendarDays className="w-4 h-4" /> Dashboard
          </Link>

          <Link
            href="/doctorDashboard/schedule"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <ClipboardList className="w-4 h-4" /> Schedule
          </Link>

          <Link
            href="/doctorDashboard/appointments"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <CalendarDays className="w-4 h-4" /> Appointments
          </Link>

          <Link
            href="/doctorDashboard/patients"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <Users className="w-4 h-4" /> Patients
          </Link>

          <Link
            href="/doctorDashboard/earnings"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <Wallet className="w-4 h-4" /> Earnings
          </Link>

        </div>
      </div>

      {/* RIGHT SECTION — Notifications + Profile + Logout */}
      <div className="flex items-center gap-4">

        {/* Notifications */}
        <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
          <Bell className="w-5 h-5 text-gray-600" />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* Profile */}
        <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
          <button className="flex items-center gap-2 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <User className="w-4 h-4 text-blue-600" />
            </div>
            <span className="text-sm font-medium text-gray-700 hidden md:block">
              Dr. John
            </span>
          </button>
        </div>

        {/* Logout */}
        <button className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors">
          <LogOut className="w-5 h-5" />
        </button>

      </div>

    </nav>
  );
}
