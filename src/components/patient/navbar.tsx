'use client';
// Made by Karan Aggarwal & Harsh Mishra

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Menu } from 'lucide-react';
import { useUserStore } from '@/store/userStore';
import Avatar from '@/components/general/Avatar';
import Logo from '@/components/general/Logo';
import NotificationMenu from '@/components/general/NotificationMenu';

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
        <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-3 sm:px-6 py-2.5 sm:py-3.5 bg-white border-b border-gray-200 shadow-xs">
            {/* Left Section - Menu Toggle & Logo & Brand */}
            <div className="flex items-center gap-2 sm:gap-6">
                {/* Menu Toggle Button */}
                <button
                    onClick={() => setSidebarOpen(!isSidebarOpen)}
                    className="p-1.5 sm:p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    aria-label="Toggle sidebar"
                >
                    <Menu className="w-5 h-5 text-gray-600" />
                </button>
                <div className="flex items-center gap-2">
                    <Logo />
                </div>

                {/* Navigation Links - Desktop */}
                <div className="hidden lg:flex items-center gap-4 xl:gap-6">
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
            <div className="flex items-center gap-2 sm:gap-3">
                {/* Notifications */}
                <NotificationMenu />
                
                {/* Profile Section */}
                <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-gray-200">
                    <Link href="/patient/profile" className="flex items-center gap-2 hover:bg-gray-100 p-1 sm:px-2 sm:py-1 rounded-lg transition-colors">
                        <Avatar
                            src={user?.profileImageUrl}
                            name={user?.name || "User"}
                            size="sm"
                        />
                        <span className="text-sm font-medium text-gray-700 hidden xl:block max-w-[120px] truncate">
                            {user?.name || "Patient"}
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
