"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";

export default function NotificationsPage(){
    const userId = useUserStore((state) => state.userId);
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

        const response = await fetch(`/api/user/${userId}/notifications`);
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

    // mark read
    const markRead = async (id: string) => {
        await fetch(`/api/user/${userId}/notifications/${id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isRead: true }),
        });

    fetchNotifications();
    };

    // delete
    const deleteNotification = async (id: string) => {
        await fetch(`/api/user/${userId}/notifications/${id}`, {
            method: "DELETE",
        });

    fetchNotifications();
    };

    return (
        <div className="max-w-xl mx-auto mt-8 p-4 bg-white shadow rounded">

            <h2 className="text-2xl font-bold mb-4">Notifications</h2>

            {/* loading */}
            {loading && <p>Loading...</p>}

            {/* no notifications */}
            {!loading && notifications.length === 0 && (
                <p className="text-gray-500">No notifications found</p>
            )}

            <div className="space-y-3">
                {visibleNotifications.map((n) => (
                <div
                    key={n.id}
                    className={`p-3 border rounded ${
                    n.isRead ? "bg-gray-100" : "bg-blue-50"
                    }`}
                >
                    <p className="font-medium">{n.message}</p>

                    <span className="text-xs text-gray-500 block">
                    {new Date(n.createdAt).toLocaleString()}
                    </span>

                    <div className="flex gap-2 mt-2">
                    
                    {!n.isRead && (
                        <button
                        onClick={() => markRead(n.id)}
                        className="text-sm bg-green-600 text-white px-2 py-1 rounded"
                        >
                        Mark Read
                        </button>
                    )}

                    <button
                        onClick={() => deleteNotification(n.id)}
                        className="text-sm bg-red-600 text-white px-2 py-1 rounded"
                    >
                        Delete
                    </button>
                    </div>

                </div>
                ))}
            </div>

            {/*"More..." button:*/}
            {!showAll && notifications.length > 4 && (
                <button
                    onClick={() => setShowAll(true)}
                    className="text-blue-600 text-sm mt-4"
                >
                    More...
                </button>
            )}

            {/*"show less..." button:*/}
            {showAll && notifications.length > 4 && (
                <button
                    onClick={() => setShowAll(false)}
                    className="text-blue-600 text-sm mt-4"
                >
                    Show Less
                </button>
            )}
            
        </div>
    );
}