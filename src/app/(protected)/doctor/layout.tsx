'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import DoctorNavbar from '@/components/doctor/navbar';
import DoctorSidebar from '@/components/doctor/sidebar';
import Footer from '@/components/general/Footer';

export default function DoctorDashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const doctorId = useUserStore((s) => s.doctorId);
  const hasHydrated = useUserStore((s) => s.hasHydrated);
  const [isSidebarOpen, setSidebarOpen] = useState<boolean>(false);
  const [checkingSchedule, setCheckingSchedule] = useState<boolean>(true);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!doctorId) {
      setCheckingSchedule(false);
      return;
    }

    if (pathname === '/doctor/schedule/weeklySchedule') {
      setCheckingSchedule(false);
      return;
    }

    const checkSchedule = async () => {
      try {
        const res = await fetch(`/api/doctors/${doctorId}/schedule`);
        if (res.status === 404) {
          router.replace('/doctor/schedule/weeklySchedule');
        } else {
          setCheckingSchedule(false);
        }
      } catch (err) {
        console.error("Error checking schedule:", err);
        setCheckingSchedule(false);
      }
    };

    checkSchedule();
  }, [doctorId, hasHydrated, pathname, router]);

  if (hasHydrated && doctorId && pathname !== '/doctor/schedule/weeklySchedule' && checkingSchedule) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
          <p className="text-muted-foreground font-medium animate-pulse">Verifying schedule configuration...</p>
        </div>
      </div>
    );
  }

  return (
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
  );
}
