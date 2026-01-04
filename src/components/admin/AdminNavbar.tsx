'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, LogOut, Menu, LayoutDashboard, FileText, ShieldAlert, UserCircle } from 'lucide-react';
import { useUserStore } from '@/store/userStore';
import Avatar from '@/components/general/Avatar';

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
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-lg">A</span>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">QuickClinic Admin</h1>
                </div>

                {/* Desktop Navigation */}
                <div className="hidden md:flex items-center gap-6">

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
            <div className="flex items-center gap-4">

                <Link href="/user/notifications">
                    <button className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors">
                        <Bell className="w-5 h-5 text-gray-600" />
                    </button>
                </Link>

                {/* Profile */}
                <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
                    <Link
                        href="/admin/profile"
                        className="flex items-center gap-2 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors"
                    >
                        <Avatar
                            src={user?.profileImageUrl}
                            name={user?.name || "Admin"}
                            size="sm"
                        />
                        <span className="text-sm font-medium text-gray-700 hidden md:block">
                            {user?.name || "Administrator"}
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
