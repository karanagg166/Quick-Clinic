'use client';
// Made by Karan Aggarwal & Harsh Mishra

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, User, LogOut, Menu } from 'lucide-react';
import { useUserStore } from '@/store/userStore';
import Avatar from '@/components/general/Avatar';
import Logo from '@/components/general/Logo';

interface PatientNavbarProps {
    isSidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;
}

export default function PatientNavbar({ isSidebarOpen, setSidebarOpen }: PatientNavbarProps) {
    const router = useRouter();
    const logout = useUserStore((state) => state.logout);
    const user = useUserStore((state) => state.user);

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
            {/* Left Section - Menu Toggle & Logo & Brand */}
            <div className="flex items-center gap-8">
                {/* Menu Toggle Button */}
                <button
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Toggle sidebar"
                >
                    <Menu className="w-5 h-5 text-gray-600" />
                </button>
                <div className="flex items-center gap-2">
                    <Logo />
                </div>

                {/* Navigation Links - Desktop */}
                <div className="hidden md:flex items-center gap-6">
                    <Link
                        href="/patient"
                        className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                    >
                        Dashboard
                    </Link>
                    <Link
                        href="/patient/appointments"
                        className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                    >
                        Appointments
                    </Link>
                    <Link
                        href="/patient/findDoctors"
                        className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                    >
                        Find Doctors
                    </Link>
                    <Link
                        href="/patient/chat"
                        className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                    >
                        Chat
                    </Link>
                </div>
            </div>

            {/* Right Section - Actions */}
            <div className="flex items-center gap-4">
                {/* Notifications */}
                <Link href="/user/notifications">
                    <button
                        className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <Bell className="w-5 h-5 text-gray-600" />
                        <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                    </button>
                </Link>
                {/* Profile Section */}
                <div className="flex items-center gap-3 pl-3 border-gray-200">
                    <Link href="/patient/profile" className="flex items-center gap-2 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors">
                        <Avatar
                            src={user?.profileImageUrl}
                            name={user?.name || "User"}
                            size="sm"
                        />
                        <span className="text-sm font-medium text-gray-700 hidden md:block">
                            {user?.name || "John Doe"}
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