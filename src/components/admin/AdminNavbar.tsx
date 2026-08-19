'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { LogOut, Menu, LayoutDashboard, FileText, ShieldAlert } from 'lucide-react';
import { useUserStore } from '@/store/userStore';
import Avatar from '@/components/general/Avatar';
import NotificationMenu from '@/components/general/NotificationMenu';

interface AdminNavbarProps {
    isSidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;
}

export default function AdminNavbar({ isSidebarOpen, setSidebarOpen }: AdminNavbarProps) {
    const router = useRouter();
    const { user, logout } = useUserStore();

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
                <div className="flex items-center gap-2">
                    <div className="w-7 h-7 sm:w-8 sm:h-8 bg-red-600 rounded-lg flex items-center justify-center shrink-0">
                        <span className="text-white font-bold text-base sm:text-lg">A</span>
                    </div>
                    <h1 className="text-base sm:text-lg font-bold text-gray-900 truncate">QuickClinic Admin</h1>
                </div>

                {/* Desktop Navigation */}
                <div className="hidden lg:flex items-center gap-4 xl:gap-6">

                    <Link
                        href="/admin"
                        className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors flex items-center gap-1"
                    >
                        <LayoutDashboard className="w-4 h-4" /> Dashboard
                    </Link>

                    <Link
                        href="/admin/logs"
                        className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors flex items-center gap-1"
                    >
                        <FileText className="w-4 h-4" /> Logs
                    </Link>

                    <Link
                        href="/admin/onboarding"
                        className="text-sm font-medium text-gray-700 hover:text-red-600 transition-colors flex items-center gap-1"
                    >
                        <ShieldAlert className="w-4 h-4" /> Onboarding
                    </Link>

                </div>
            </div>

            {/* RIGHT SECTION — Notifications + Profile + Logout */}
            <div className="flex items-center gap-2 sm:gap-3">

                <NotificationMenu />

                {/* Profile */}
                <div className="flex items-center gap-2 pl-1 sm:pl-2 border-l border-gray-200">
                    <Link
                        href="/admin/profile"
                        className="flex items-center gap-2 hover:bg-gray-100 p-1 sm:px-2 sm:py-1 rounded-lg transition-colors"
                    >
                        <Avatar
                            src={user?.profileImageUrl}
                            name={user?.name || "Admin"}
                            size="sm"
                        />
                        <span className="text-sm font-medium text-gray-700 hidden xl:block max-w-[120px] truncate">
                            {user?.name || "Administrator"}
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
