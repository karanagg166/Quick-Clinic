"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RecentLogsWidget } from "@/components/admin/dashboard/RecentLogsWidget";
import { format } from "date-fns";

export default function UserLogsPage() {
    const params = useParams();
    const userId = params.userId as string;
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLogs = async () => {
            try {
                const searchParams = new URLSearchParams();
                searchParams.append("userId", userId);
                const res = await fetch(`/api/admin/logs?${searchParams.toString()}`);
                const data = await res.json();
                if (data.logs) setLogs(data.logs);
            } catch (error) {
                console.error("Failed to fetch user logs", error);
            } finally {
                setLoading(false);
            }
        }
        if (userId) fetchLogs();
    }, [userId]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">User Activity History</h1>
                <p className="text-muted-foreground">Viewing logs for User ID: {userId}</p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Activity Log ({logs.length})</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p>Loading...</p>
                    ) : (
                        <RecentLogsWidget logs={logs} />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
