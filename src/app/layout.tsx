import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import Watermark from "@/components/general/Watermark";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "QuickClinic - Modern Healthcare Platform",
  description: "Connect with doctors, manage appointments, and access healthcare services seamlessly",
  authors: [{ name: "Karan Aggarwal" }, { name: "Harsh Mishra" }],
  creator: "Karan Aggarwal",
  publisher: "Quick Clinic",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={`${inter.className} antialiased`}>
        {children}
        <Toaster />
        <Watermark />
        <div style={{ display: 'none' }} aria-hidden="true" data-author="Karan Aggarwal & Harsh Mishra">
          QuickClinic - Made by Karan Aggarwal & Harsh Mishra. All rights reserved.
        </div>
      </body>
    </html>
  );
}
