'use client';
// Made by Karan Aggarwal & Harsh Mishra

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Menu, CalendarDays, ClipboardList, Users, Wallet, MessageCircle, Clock } from 'lucide-react';
import { useUserStore } from '@/store/userStore';
import Avatar from '@/components/general/Avatar';
import NotificationMenu from '@/components/general/NotificationMenu';
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
    <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3.5 bg-white border-b border-gray-200 shadow-xs">

      {/* LEFT SECTION — Logo + Sidebar Toggle + Nav Links */}
      <div className="flex items-center gap-2 sm:gap-6">

        {/* Menu Button */}
        <button
          onClick={() => setSidebarOpen(!isSidebarOpen)}
          className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-5 h-5 text-gray-600" />
        </button>

        {/* Logo */}
        <Logo />

        {/* Desktop Navigation */}
        <div className="hidden lg:flex items-center gap-4 xl:gap-6">

          <Link
            href="/doctor"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <CalendarDays className="w-4 h-4" /> Dashboard
          </Link>

          <Link
            href="/doctor/today"
            className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors flex items-center gap-1"
          >
            <Clock className="w-4 h-4" /> Today
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
      <div className="flex items-center gap-2 sm:gap-3">

        {/* Balance Display */}
        {doctorId && (
          <Link href="/doctor/earnings">
            <div className="flex items-center gap-1.5 px-2 py-1 sm:px-3 sm:py-1.5 bg-green-50 hover:bg-green-100 rounded-lg transition-colors border border-green-200">
              <Wallet className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-700" />
              <span className="text-xs sm:text-sm font-semibold text-green-700">
                {loadingBalance ? (
                  '...'
                ) : (
                  `₹${balance !== null ? balance.toFixed(0) : '0'}`
                )}
              </span>
            </div>
          </Link>
        )}

        <NotificationMenu />

        {/* Profile */}
        <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-gray-200">
          <Link
            href="/doctor/profile"
            className="flex items-center gap-2 hover:bg-gray-100 p-1 sm:px-2 sm:py-1 rounded-lg transition-colors"
          >
            <Avatar
              src={user?.profileImageUrl}
              name={user?.name || "Doctor"}
              size="sm"
            />
            <span className="text-sm font-medium text-gray-700 hidden xl:block max-w-[120px] truncate">
              {user?.name || "Dr. John"}
            </span>
          </Link>
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="p-1.5 sm:p-2 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
          title="Logout"
        >
          <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

      </div>

    </nav>
  );
}
