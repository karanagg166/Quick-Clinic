'use client';
// Made by Karan Aggarwal & Harsh Mishra

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Menu, CalendarDays, ClipboardList, Users, Wallet, MessageCircle } from 'lucide-react';
import { useUserStore } from '@/store/userStore';
import Avatar from '@/components/general/Avatar';
import Logo from '@/components/general/Logo';

interface DoctorNavbarProps {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export default function DoctorNavbar({ isSidebarOpen, setSidebarOpen }: DoctorNavbarProps) {
  const router = useRouter();
  const logout = useUserStore((state) => state.logout);
  const user = useUserStore((state) => state.user);
  const doctorId = useUserStore((state) => state.doctorId);
  const [balance, setBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(true);

  // Fetch doctor balance
  useEffect(() => {
    const fetchBalance = async () => {
      if (!doctorId) {
        setLoadingBalance(false);
        return;
      }

      try {
        const response = await fetch(`/api/doctors/${doctorId}/balance`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setBalance(data.balanceInRupees);
        }
      } catch (error) {
        console.error('Failed to fetch balance:', error);
      } finally {
        setLoadingBalance(false);
      }
    };

    fetchBalance();
    // Refresh balance every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, [doctorId]);

  const handleLogout = async () => {
    try {
      await fetch('/api/user/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.error('Logout failed', err);
    }
    logout();
    router.push('/auth/login');
  };

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">

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
        <Logo />

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center gap-6">

          <Link
            href="/doctor"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <CalendarDays className="w-4 h-4" /> Dashboard
          </Link>

          <Link
            href="/doctor/schedule"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <ClipboardList className="w-4 h-4" /> Schedule
          </Link>

          <Link
            href="/doctor/appointments"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <CalendarDays className="w-4 h-4" /> Appointments
          </Link>

          <Link
            href="/doctor/findPatients"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <Users className="w-4 h-4" /> Patients
          </Link>

          <Link
            href="/doctor/chat"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <MessageCircle className="w-4 h-4" /> Chat
          </Link>

          <Link
            href="/doctor/earnings"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <Wallet className="w-4 h-4" /> Earnings
          </Link>

        </div>
      </div>

      {/* RIGHT SECTION — Balance + Notifications + Profile + Logout */}
      <div className="flex items-center gap-4">

        {/* Balance Display */}
        {doctorId && (
          <Link href="/doctor/earnings">
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 hover:bg-green-100 rounded-lg transition-colors border border-green-200">
              <Wallet className="w-4 h-4 text-green-700" />
              <span className="text-sm font-semibold text-green-700">
                {loadingBalance ? (
                  '...'
                ) : (
                  `₹${balance !== null ? balance.toFixed(2) : '0.00'}`
                )}
              </span>
            </div>
          </Link>
        )}

        <Link href="/user/notifications">
          <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
            <Bell className="w-5 h-5 text-gray-600" />
            <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
          </button>
        </Link>

        {/* Profile */}

        <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
          <Link
            href="/doctor/profile"
            className="flex items-center gap-2 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors"
          >
            <Avatar
              src={user?.profileImageUrl}
              name={user?.name || "Doctor"}
              size="sm"
            />
            <span className="text-sm font-medium text-gray-700 hidden md:block">
              {user?.name || "Dr. John"}
            </span>
          </Link>
        </div>



        {/* Logout */}
        <button
          onClick={handleLogout}
          className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
          title="Logout"
        >
          <LogOut className="w-5 h-5" />
        </button>

      </div>

    </nav>
  );
}