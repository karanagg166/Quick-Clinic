
import React from 'react';
import PatientNavbar from '@/components/patient/patientNavbar';

export default function RootLayout({children}: Readonly<{children: React.ReactNode}>) {
  return (
    <>
      <div>
        <PatientNavbar />
        <main className="p-6 bg-gray-50 min-h-screen">
          {children}
        </main>
      </div>
    </>
  );
}