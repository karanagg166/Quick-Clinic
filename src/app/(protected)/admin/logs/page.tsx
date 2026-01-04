"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { showToast } from "@/lib/toast";
import { LogFilters } from "@/components/admin/dashboard/LogFilters";
import { useUserStore } from "@/store/userStore";

type Log = {
    id: string;
    userId: string | null;
    user?: {
        name: string;
        email: string;
        role: string;
    };
    action: string;
    metadata?: any;
    targetId?: string;
    createdAt: string;
};

export default function LogsPage() {
    const { user } = useUserStore(); // Get current user for scope
    const [logs, setLogs] = useState<Log[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState({ type: "audit", scope: "all" });

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            params.append("type", filters.type);

            if (filters.scope === "my" && user?.id) {
                params.append("userId", user.id);
                params.append("scope", "my");
            }

            const res = await fetch(`/api/admin/logs?${params.toString()}`);
            const data = await res.json();

            if (data.logs) {
                setLogs(data.logs);
            } else {
                setLogs([]);
            }
        } catch (error) {
            console.error("Failed to fetch logs", error);
            showToast.error("Failed to fetch logs");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // debounce or just fetch on filter change
        fetchLogs();
    }, [filters, user]);

    const handleFilterChange = (newFilters: any) => {
        setFilters(prev => ({ ...prev, ...newFilters }));
    };

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">System Logs</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Log Entries</CardTitle>
                    <div className="mt-4">
                        <LogFilters onFilterChange={handleFilterChange} loading={loading} />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Timestamp</TableHead>
                                    <TableHead>User</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center">
                                            Loading...
                                        </TableCell>
                                    </TableRow>
                                ) : logs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={4} className="h-24 text-center">
                                            No logs found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    logs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="whitespace-nowrap">
                                                {format(new Date(log.createdAt), "PP p")}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium">{log.user?.name || "Unknown"}</span>
                                                    <span className="text-xs text-muted-foreground">{log.user?.email}</span>
                                                    <Badge variant="outline" className="w-fit mt-1 text-[10px]">{log.user?.role || "N/A"}</Badge>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={filters.type === "audit" ? "default" : "secondary"}>
                                                    {log.action}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="max-w-md truncate">
                                                {filters.type === "access" ? (
                                                    <span className="text-sm text-muted-foreground">Target ID: {log.targetId || "N/A"}</span>
                                                ) : (
                                                    <code className="text-xs bg-muted p-1 rounded">
                                                        {JSON.stringify(log.metadata || {})}
                                                    </code>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
