"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import { AdminStats } from "@/components/admin/profile/AdminStats";
import { RecentLogsWidget } from "@/components/admin/dashboard/RecentLogsWidget";
import { LogFilters } from "@/components/admin/dashboard/LogFilters";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { showToast } from "@/lib/toast";

export default function AdminDashboardPage() {
    const { user } = useUserStore();
    const [logs, setLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(true);
    const [filters, setFilters] = useState({ scope: "all", type: "audit" });

    useEffect(() => {
        const fetchLogs = async () => {
            setLoadingLogs(true);
            try {
                const params = new URLSearchParams();
                if (filters.scope === "my" && user?.id) {
                    params.append("userId", user.id);
                    // We tell API to verify user owns this ID or just trust 'my' scope logic on server
                    params.append("scope", "my");
                }
                params.append("type", filters.type);

                const res = await fetch(`/api/admin/logs?${params.toString()}`);
                const data = await res.json();
                if (data.logs) {
                    setLogs(data.logs);
                }
            } catch (error) {
                console.error("Failed to fetch dashboard logs", error);
                showToast.error("Failed to update dashboard");
            } finally {
                setLoadingLogs(false);
            }
        };

        if (user) {
            fetchLogs();
        }
    }, [user, filters]);

    const handleFilterChange = (newFilters: any) => {
        setFilters((prev) => ({ ...prev, ...newFilters }));
    };

    return (
        <div className="min-h-screen bg-background px-4 py-8">
            <div className="max-w-6xl mx-auto space-y-8">
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
                        <p className="text-muted-foreground">Welcome back, {user?.name}</p>
                    </div>
                    <div className="flex gap-2">
                        <Link href="/admin/logs">
                            <Button variant="outline">View All Logs</Button>
                        </Link>
                    </div>
                </div>

                {/* Stats Overview */}
                <AdminStats />

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {/* Log Filters & Recent Widget */}
                    <div className="col-span-full">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold">Recent System Activity</h2>
                            <LogFilters onFilterChange={handleFilterChange} loading={loadingLogs} />
                        </div>
                        <RecentLogsWidget logs={logs} />
                    </div>
                </div>
            </div>
        </div>
    );
}
