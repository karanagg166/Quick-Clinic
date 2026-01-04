'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    LayoutDashboard,
    FileText,
    UserCircle,
    Settings,
    ChevronDown,
    X,
    ShieldAlert,
    Users
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface AdminSidebarProps {
    isSidebarOpen: boolean;
    setSidebarOpen: (open: boolean) => void;
}

export default function AdminSidebar({ isSidebarOpen, setSidebarOpen }: AdminSidebarProps) {
    const pathname = usePathname();
    const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

    const isActive = (href: string) => {
        return pathname === href || pathname.startsWith(href + '/');
    };

    const menuItems = [
        {
            label: 'Dashboard',
            href: '/admin',
            icon: LayoutDashboard,
        },
        {
            label: 'Monitor Logs',
            href: '/admin/logs',
            icon: FileText,
        },
        {
            label: 'Onboarding',
            href: '/admin/onboarding',
            icon: ShieldAlert,
        },
        {
            label: 'Admin Profile',
            href: '/admin/profile',
            icon: UserCircle,
        },
        // Add Placeholder for Settings if needed to match doctor
        // {
        //   label: 'Settings',
        //   href: '/admin/settings',
        //   icon: Settings,
        // },
    ];

    return (
        <>
            {/* Sidebar */}
            <aside
                className={`fixed top-0 left-0 h-full w-64 bg-card border-r shadow-lg transform ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full'
                    } transition-transform duration-300 ease-in-out z-[60] overflow-y-auto`}
            >
                {/* Header */}
                <Card className="border-0 border-b rounded-none shadow-none">
                    <CardContent className="p-6 flex items-center justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-foreground">Admin Portal</h2>
                            <p className="text-xs text-muted-foreground mt-1">System Management</p>
                        </div>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSidebarOpen(false)}
                            className="h-8 w-8"
                        >
                            <X className="w-5 h-5" />
                        </Button>
                    </CardContent>
                </Card>

                {/* MENU */}
                <nav className="p-4">
                    <ul className="space-y-2">
                        {menuItems.map((item) => {
                            const IconComponent = item.icon;
                            const isItemActive = isActive(item.href);

                            return (
                                <li key={item.label}>
                                    <div className="flex items-center">
                                        <Button
                                            asChild
                                            variant={isItemActive ? "secondary" : "ghost"}
                                            className={`w-full justify-start ${isItemActive ? "bg-primary/10 text-primary font-semibold" : ""
                                                }`}
                                            onClick={() => setSidebarOpen(false)}
                                        >
                                            <Link href={item.href} className="flex items-center gap-3">
                                                <IconComponent className="w-5 h-5" />
                                                <span>{item.label}</span>
                                            </Link>
                                        </Button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                </nav>

            </aside>
        </>
    );
}
