'use client';

import Link from 'next/link';
import { Bell, User, LogOut, Menu } from 'lucide-react';

interface PatientNavbarProps {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export default function PatientNavbar({ isSidebarOpen, setSidebarOpen }: PatientNavbarProps) {
    
    return (
        <nav className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
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
                    <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                        <span className="text-white font-bold text-lg">Q</span>
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">
                        QuickClinic
                    </h1>
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
                        href="/patient/doctors" 
                        className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                    >
                        Find Doctors
                    </Link>
                    <Link 
                        href="/patient/prescriptions" 
                        className="text-sm font-medium text-gray-700 hover:text-blue-600 transition-colors"
                    >
                        Prescriptions
                    </Link>
                </div>
            </div>

            {/* Right Section - Actions */}
            <div className="flex items-center gap-4">
                {/* Notifications */}
                <button 
                    className="relative p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <Bell className="w-5 h-5 text-gray-600" />
                    <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full"></span>
                </button>

                {/* Profile Section */}
                <div className="flex items-center gap-3 pl-3 border-l border-gray-200">
                    <button className="flex items-center gap-2 hover:bg-gray-100 px-2 py-1 rounded-lg transition-colors">
                        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                            <User className="w-4 h-4 text-blue-600" />
                        </div>
                        <span className="text-sm font-medium text-gray-700 hidden md:block">
                            John Doe
                        </span>
                    </button>
                </div>

                {/* Logout */}
                <button 
                    className="p-2 hover:bg-red-50 hover:text-red-600 rounded-lg transition-colors"
                >
                    <LogOut className="w-5 h-5" />
                </button>

            </div>

            
        </nav>
    );
}