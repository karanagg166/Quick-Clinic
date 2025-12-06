'use client';

import React from 'react';
import { useState } from 'react';
import DoctorNavbar from '@/components/doctor/navbar';
import DoctorSidebar from '@/components/doctor/sidebar';

export default function DoctorDashboardLayout({children}: Readonly<{children: React.ReactNode}>) {

  const [isSidebarOpen, setSidebarOpen] = useState<boolean>(false);

  return (
    <>
      <div>
        {isSidebarOpen && <DoctorSidebar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />}
        <DoctorNavbar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />
        <main className="p-6 bg-gray-50 min-h-screen">
          {children}
        </main>
      </div>
    </>
  );
}
