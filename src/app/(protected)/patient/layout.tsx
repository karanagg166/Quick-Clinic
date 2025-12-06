'use client';


import React from 'react';
import { useState } from 'react';
import PatientNavbar from '@/components/patient/navbar';
import PatientSidebar from '@/components/patient/sidebar';

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {

  const [isSidebarOpen, setSidebarOpen] = useState<boolean>(false);

  return (
    <>
      <div>
        {isSidebarOpen && <PatientSidebar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />}
        <PatientNavbar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />
        <main className="p-6 bg-gray-50 min-h-screen">
          {children}
        </main>
      </div>
    </>
  );
}