'use client';

import Link from 'next/link';
import { Bell, User, LogOut, Menu, X } from 'lucide-react';
import { useState } from 'react';

export default function PatientNavbar() {
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    return (
        <nav className="flex items-center justify-between px-6 py-4 bg-white border-b border-gray-200 shadow-sm">
            {/* Left Section - Logo & Brand */}
            <div className="flex items-center gap-8">
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

                {/* Mobile Menu Button */}
                <button 
                    onClick={() => setIsMenuOpen(!isMenuOpen)}
                    className="md:hidden p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    {isMenuOpen ? (
                        <X className="w-5 h-5 text-gray-600" />
                    ) : (
                        <Menu className="w-5 h-5 text-gray-600" />
                    )}
                </button>
            </div>

            {/* Mobile Menu - Dropdown */}
            {isMenuOpen && (
                <div className="absolute top-full left-0 right-0 bg-white border-b border-gray-200 md:hidden">
                    <div className="flex flex-col px-6 py-4 gap-2">
                        <Link 
                            href="/patient" 
                            className="text-sm font-medium text-gray-700 hover:text-blue-600 py-2 transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Dashboard
                        </Link>
                        <Link 
                            href="/patient/appointments" 
                            className="text-sm font-medium text-gray-700 hover:text-blue-600 py-2 transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Appointments
                        </Link>
                        <Link 
                            href="/patient/doctors" 
                            className="text-sm font-medium text-gray-700 hover:text-blue-600 py-2 transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Find Doctors
                        </Link>
                        <Link 
                            href="/patient/prescriptions" 
                            className="text-sm font-medium text-gray-700 hover:text-blue-600 py-2 transition-colors"
                            onClick={() => setIsMenuOpen(false)}
                        >
                            Prescriptions
                        </Link>
                    </div>
                </div>
            )}
        </nav>
    );
}