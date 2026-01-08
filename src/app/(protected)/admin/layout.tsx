"use client";

import { useUserStore } from "@/store/userStore";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import AdminSidebar from "@/components/admin/AdminSidebar";
import AdminNavbar from "@/components/admin/AdminNavbar";
import Footer from "@/components/general/Footer";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const { user, hasHydrated } = useUserStore();
    const router = useRouter();
    const [isAuthorized, setIsAuthorized] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    useEffect(() => {
        // Wait for hydration to complete
        if (hasHydrated) {
            if (!user) {
                router.push("/auth/login");
            } else if (user.role !== "ADMIN") {
                router.push("/unauthorized");
            } else {
                setIsAuthorized(true);
            }
        }
    }, [user, hasHydrated, router]);

    if (!hasHydrated || !isAuthorized) {
        return (
            <div className="h-screen w-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin" />
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-muted/20">
            <AdminSidebar isSidebarOpen={isSidebarOpen} setSidebarOpen={setIsSidebarOpen} />
            <AdminNavbar isSidebarOpen={isSidebarOpen} setSidebarOpen={setIsSidebarOpen} />

            <main className="md:ml-64 pt-24 min-h-screen p-6 bg-background">
                {children}
                <div className="mt-8">
                    <Footer />
                </div>
            </main>
        </div>
    );
}
