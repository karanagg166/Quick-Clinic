'use client';

import React from 'react';
import { useState } from 'react';
import DoctorNavbar from '@/components/doctor/navbar';
import DoctorSidebar from '@/components/doctor/sidebar';
import Footer from '@/components/general/Footer';

export default function DoctorDashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {

  const [isSidebarOpen, setSidebarOpen] = useState<boolean>(false);

  return (
    <>
      <div className="min-h-screen">
        {isSidebarOpen && <DoctorSidebar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />}
        <DoctorNavbar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />
        <main className="p-6 bg-background min-h-screen pt-24">
          {children}
          <div className="mt-8">
            <Footer />
          </div>
        </main>
      </div>
    </>
  );
}
