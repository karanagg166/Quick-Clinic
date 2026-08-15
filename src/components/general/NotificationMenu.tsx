'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNotifications } from '@/hooks/useNotifications';
import { useUserStore } from '@/store/userStore';

type Notification = {
  id: string;
  message: string;
  actionHref?: string | null;
  actionLabel?: string | null;
  createdAt: string;
  isRead: boolean;
};

export default function NotificationMenu() {
  const userId = useUserStore((state) => state.user?.id);
  const { notifications: socketNotifications } = useNotifications();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId) return;

    const timeout = window.setTimeout(() => {
      void fetch(`/api/user/${userId}/notification`)
        .then((response) => response.ok ? response.json() : [])
        .then((data: Notification[]) => setNotifications(data.slice(0, 5)))
        .catch(() => {});
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [userId, socketNotifications.length]);

  const unreadCount = notifications.filter((notification) => !notification.isRead).length;

  const markRead = async (id: string) => {
    if (!userId) return;
    await fetch(`/api/user/${userId}/notification/${id}`, { method: 'PATCH' });
    setNotifications((current) => current.map((notification) => (
      notification.id === id ? { ...notification, isRead: true } : notification
    )));
  };

  return (
    <div className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onMouseEnter={() => setOpen(true)}
        className="relative rounded-lg p-2 transition-colors hover:bg-gray-100"
        aria-label="Open notifications"
        aria-expanded={open}
      >
        <Bell className="h-5 w-5 text-gray-600" />
        {unreadCount > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-red-500" />}
      </button>

      {open && (
        <section className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b px-4 py-3">
            <div>
              <p className="font-semibold text-gray-900">Recent notifications</p>
              <p className="text-xs text-gray-500">Your latest five updates</p>
            </div>
            <Link href="/user/notifications" onClick={() => setOpen(false)} className="text-sm font-medium text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </header>
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-500">No notifications yet.</p>
            ) : notifications.map((notification) => (
              <div key={notification.id} className={`border-b px-4 py-3 last:border-0 ${notification.isRead ? 'bg-white' : 'bg-blue-50/60'}`}>
                <p className="text-sm leading-5 text-gray-800">{notification.message}</p>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-500">{new Date(notification.createdAt).toLocaleString()}</span>
                  <div className="flex items-center gap-1">
                    {notification.actionHref && (
                      <Button asChild size="sm" variant="outline" onClick={() => markRead(notification.id)}>
                        <Link href={notification.actionHref}>{notification.actionLabel || 'Open'}</Link>
                      </Button>
                    )}
                    {!notification.isRead && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => markRead(notification.id)} aria-label="Mark as read">
                        <CheckCheck className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
