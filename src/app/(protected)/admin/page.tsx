"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import { AdminStats } from "@/components/admin/profile/AdminStats";
import { RecentLogsWidget } from "@/components/admin/dashboard/RecentLogsWidget";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity, Clock } from "lucide-react";

export default function AdminDashboardPage() {
    const { user } = useUserStore();
    const [logs, setLogs] = useState([]);
    const [loadingLogs, setLoadingLogs] = useState(true);

    useEffect(() => {
        const fetchLogs = async () => {
            setLoadingLogs(true);
            try {
                const params = new URLSearchParams();
                params.append("type", "audit");

                const res = await fetch(`/api/admin/logs?${params.toString()}`);
                const data = await res.json();
                if (data.logs) {
                    setLogs(data.logs);
                }
            } catch (error) {
                console.error("Failed to fetch dashboard logs", error);
            } finally {
                setLoadingLogs(false);
            }
        };

        if (user) {
            fetchLogs();
        }
    }, [user]);

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
                    <p className="text-muted-foreground">System Overview & Live Activity</p>
                </div>
                <div className="flex gap-2">
                    <Link href="/admin/logs">
                        <Button>View All Logs</Button>
                    </Link>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Recent Logins</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">--</div>
                        <p className="text-xs text-muted-foreground">Past 24 hours</p>
                    </CardContent>
                </Card>
                <div className="col-span-3">
                    <AdminStats />
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-7">
                <div className="col-span-4">
                    <Card className="h-full">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Activity className="h-5 w-5" />
                                Live Activity Feed
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <RecentLogsWidget logs={logs} />
                        </CardContent>
                    </Card>
                </div>

                <div className="col-span-3">
                    <Card className="h-full">
                        <CardHeader>
                            <CardTitle>Quick Actions</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                            <Link href="/admin/onboarding" className="block">
                                <div className="p-4 border rounded-lg hover:bg-muted transition-colors cursor-pointer">
                                    <h3 className="font-semibold">Review Onboarding Requests</h3>
                                    <p className="text-xs text-muted-foreground">Check pending admin approvals</p>
                                </div>
                            </Link>
                            <Link href="/admin/logs" className="block">
                                <div className="p-4 border rounded-lg hover:bg-muted transition-colors cursor-pointer">
                                    <h3 className="font-semibold">Deep Dive Logs</h3>
                                    <p className="text-xs text-muted-foreground">Filter by User, IP, or Action</p>
                                </div>
                            </Link>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
