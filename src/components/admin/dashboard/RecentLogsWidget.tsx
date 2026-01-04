"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Log } from "@/types/admin"; // We will need to define this type or reuse

export function RecentLogsWidget({ logs }: { logs: any[] }) {
    return (
        <Card className="col-span-1 md:col-span-2">
            <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-[300px] w-full pr-4">
                    <div className="space-y-4">
                        {logs.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">No recent activity.</p>
                        ) : (
                            logs.map((log) => (
                                <div key={log.id} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium leading-none">{log.action}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {log.user?.email || "System"} • {format(new Date(log.createdAt), "PP p")}
                                        </p>
                                    </div>
                                    <div className="text-xs text-muted-foreground text-right max-w-[120px] truncate">
                                        {log.metadata ? "Audit" : "Access"}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}
