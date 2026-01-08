'use client';


import React from 'react';
import { useState } from 'react';
import PatientNavbar from '@/components/patient/navbar';
import PatientSidebar from '@/components/patient/sidebar';
import Footer from '@/components/general/Footer';

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {

  const [isSidebarOpen, setSidebarOpen] = useState<boolean>(false);

  return (
    <>
      <div className="min-h-screen">
        {isSidebarOpen && <PatientSidebar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />}
        <PatientNavbar isSidebarOpen={isSidebarOpen} setSidebarOpen={setSidebarOpen} />
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