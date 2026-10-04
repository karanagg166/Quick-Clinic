"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
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

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

type Log = {
    id: string;
    userId: string | null;
    user?: {
        name: string;
        email: string;
        role: string;
    };
    action: string;
    tag?: string | null;
    metadata?: any;
    targetId?: string;
    createdAt: string;
};

export default function LogsPage() {
    const { user } = useUserStore(); // Get current user for scope
    const [logs, setLogs] = useState<Log[]>([]);
    const [loading, setLoading] = useState(true);
    const [filters, setFilters] = useState<{
        type: string;
        scope: string;
        tag?: string;
        action?: string;
    }>({ type: "audit", scope: "all", tag: "", action: "" });

    const fetchLogs = async () => {
        try {
            setLoading(true);
            const params = new URLSearchParams();
            params.append("type", filters.type);

            if (filters.scope === "my" && user?.id) {
                params.append("userId", user.id);
                params.append("scope", "my");
            }

            if (filters.tag) {
                params.append("tag", filters.tag);
            }

            if (filters.action) {
                params.append("action", filters.action);
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
        fetchLogs();
    }, [filters, user]);

    const handleFilterChange = (newFilters: any) => {
        setFilters(prev => ({ ...prev, ...newFilters }));
    };

    const getActionBadgeVariant = (action: string) => {
        if (action.includes("DENIED")) return "destructive";
        if (action.includes("VIEW") || action.includes("DOWNLOAD") || action.includes("LIST")) return "secondary";
        return "default";
    };

    return (
        <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
            <div className="flex items-center justify-between">
                <Button variant="ghost" size="sm" asChild className="gap-1.5">
                    <Link href="/admin">
                        <ArrowLeft className="w-4 h-4" /> Back to Dashboard
                    </Link>
                </Button>
            </div>

            <div className="flex items-center justify-between">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">System & Audit Logs</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Log Entries</CardTitle>
                    <div className="mt-4">
                        <LogFilters onFilterChange={handleFilterChange} loading={loading} />
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border overflow-x-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Timestamp</TableHead>
                                    <TableHead>User / Actor</TableHead>
                                    <TableHead>Category / Tag</TableHead>
                                    <TableHead>Action</TableHead>
                                    <TableHead>Details / Target</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            Loading logs...
                                        </TableCell>
                                    </TableRow>
                                ) : logs.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center">
                                            No logs found matching criteria.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    logs.map((log) => (
                                        <TableRow key={log.id}>
                                            <TableCell className="whitespace-nowrap text-xs">
                                                {format(new Date(log.createdAt), "PP p")}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex flex-col">
                                                    <span className="font-medium text-xs">
                                                        {log.user?.name || "System"}
                                                    </span>
                                                    <span className="text-[11px] text-muted-foreground">
                                                        {log.user?.email || "No email"}
                                                    </span>
                                                    <Badge variant="outline" className="w-fit mt-1 text-[10px]">
                                                        {log.user?.role || "SYSTEM"}
                                                    </Badge>
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="outline"
                                                    className={`text-[10px] ${
                                                        log.tag === "MEDICAL_RECORD"
                                                            ? "border-primary/50 text-primary font-semibold"
                                                            : ""
                                                    }`}
                                                >
                                                    {log.tag || "SYSTEM"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant={getActionBadgeVariant(log.action)}
                                                    className="text-xs"
                                                >
                                                    {log.action}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="max-w-md text-xs">
                                                {filters.type === "access" ? (
                                                    <span className="text-muted-foreground">
                                                        Target ID: <span className="font-mono text-foreground">{log.targetId || "N/A"}</span>
                                                    </span>
                                                ) : (
                                                    <code className="text-[11px] bg-muted px-1.5 py-0.5 rounded break-all">
                                                        {typeof log.metadata === "string"
                                                            ? log.metadata
                                                            : JSON.stringify(log.metadata || {})}
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
