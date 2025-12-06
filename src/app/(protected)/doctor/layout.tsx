'use client';

import React, { useState } from 'react';
import DoctorNavbar from '@/components/doctor/navbar';
import DoctorSidebar from '@/components/doctor/sidebar';

export default function DoctorLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {

  const [isSidebarOpen, setSidebarOpen] = useState<boolean>(false);

  return (
    <div className="flex min-h-screen bg-gray-50">

      {/* Doctor Sidebar */}
      <DoctorSidebar 
        isSidebarOpen={isSidebarOpen} 
        setSidebarOpen={setSidebarOpen} 
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col">

        {/* Doctor Navbar */}
        <DoctorNavbar 
          isSidebarOpen={isSidebarOpen} 
          setSidebarOpen={setSidebarOpen} 
        />

        {/* Page Content */}
        <main className="p-6 mt-2">
          {children}
        </main>
      </div>
    </div>
  );
}
