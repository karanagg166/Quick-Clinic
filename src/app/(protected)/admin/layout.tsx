"use client";

import { useUserStore } from "@/store/userStore";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
    const { user, hasHydrated } = useUserStore();
    const router = useRouter();
    const pathname = usePathname();
    const [isAuthorized, setIsAuthorized] = useState(false);

    useEffect(() => {
        // Wait for hydration to complete
        if (hasHydrated) {
            if (!user) {
                router.push("/user/login");
            } else if (user.role !== "ADMIN") {
                router.push("/unauthorized"); // Or back to their dashboard
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
        <div className="min-h-screen bg-background">
            {/* Assuming there might be a shared sidebar or nav, but for now just children */}
            {children}
        </div>
    );
}
