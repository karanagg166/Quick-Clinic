"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import { useNotifications } from "@/hooks/useNotifications";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell, Wifi, WifiOff } from "lucide-react";
import EmptyState from "@/components/general/EmptyState";

export default function NotificationsPage(){
    const userId = useUserStore((state) => state.user?.id);
    const { notifications: socketNotifications, isConnected } = useNotifications();
    const [notifications, setNotifications] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [showAll, setShowAll] = useState(false);
    
    // Decide visible items:
    const visibleNotifications = showAll
        ? notifications
        : notifications.slice(0, 4);

    // fetch notifications
    const fetchNotifications = async () => {
        setLoading(true);

        const response = await fetch(`/api/user/${userId}/notification`);
        if (!response.ok) {
            setLoading(false);
            return; 
        }
        const data = await response.json();
     
        setNotifications(data);
        setLoading(false);
    };

    useEffect(() => {
        if (!userId) return;
        fetchNotifications();
    }, [userId]);

    // Merge socket notifications with fetched notifications
    useEffect(() => {
        if (socketNotifications.length > 0) {
            // Refresh from API to get full data including the new notification
            fetchNotifications();
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [socketNotifications.length]);

    // mark read
    const markRead = async (id: string) => {
        await fetch(`/api/user/${userId}/notification/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isRead: true }),
            credentials:"include"
        });

    fetchNotifications();
    };

    // delete
    const deleteNotification = async (id: string) => {
        await fetch(`/api/user/${userId}/notification/${id}`, {
            method: "DELETE",
            credentials:"include"
        });

    fetchNotifications();
    };

    return (
        <div className="min-h-screen p-6 space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-semibold mb-2">Notifications</h1>
                    <p className="text-muted-foreground">Manage your notifications</p>
                </div>
                <div className="flex items-center gap-2">
                    {isConnected ? (
                        <>
                            <Wifi className="w-4 h-4 text-green-600" />
                            <span className="text-sm text-muted-foreground">Live updates active</span>
                        </>
                    ) : (
                        <>
                            <WifiOff className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">Reconnecting...</span>
                        </>
                    )}
                </div>
            </div>

            <Card className="max-w-2xl">
                <CardHeader>
                    <CardTitle>Your Notifications</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* loading */}
                    {loading && (
                        <div className="space-y-3">
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                            <Skeleton className="h-20 w-full" />
                        </div>
                    )}

                    {/* no notifications */}
                    {!loading && notifications.length === 0 && (
                        <EmptyState
                            icon={Bell}
                            title="No notifications yet"
                            description="You'll see notifications here when you receive updates about appointments, messages, and other activities."
                        />
                    )}

                    <div className="space-y-3">
                        {visibleNotifications.map((n) => (
                            <Card key={n.id} className={n.isRead ? "border bg-muted/50" : "border shadow-sm"}>
                                <CardContent className="p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-2">
                                                <p className="font-medium text-foreground">{n.message}</p>
                                                {!n.isRead && <Badge variant="default" className="text-xs">New</Badge>}
                                            </div>
                                            <span className="text-xs text-muted-foreground">
                                                {new Date(n.createdAt).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="flex gap-2">
                                            {!n.isRead && (
                                                <Button
                                                    onClick={() => markRead(n.id)}
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    Mark Read
                                                </Button>
                                            )}
                                            <Button
                                                onClick={() => deleteNotification(n.id)}
                                                variant="outline"
                                                size="sm"
                                            >
                                                Delete
                                            </Button>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                    </div>

                    {/*"More..." button:*/}
                    {!showAll && notifications.length > 4 && (
                        <Button
                            onClick={() => setShowAll(true)}
                            variant="outline"
                            className="w-full"
                        >
                            Show More ({notifications.length - 4} more)
                        </Button>
                    )}

                    {/*"show less..." button:*/}
                    {showAll && notifications.length > 4 && (
                        <Button
                            onClick={() => setShowAll(false)}
                            variant="outline"
                            className="w-full"
                        >
                            Show Less
                        </Button>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}