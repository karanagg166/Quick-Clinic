'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  CalendarDays,
  Users,
  FileClock,
  ClipboardList,
  Wallet,
  UserCircle,
  Settings,
  ChevronDown,
  X,
  MessageCircle
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface DoctorSidebarProps {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export default function DoctorSidebar({ isSidebarOpen, setSidebarOpen }: DoctorSidebarProps) {
  const pathname = usePathname();
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  const isActive = (href: string) => {
    return pathname === href || pathname.startsWith(href + '/');
  };

  // UPDATED: doctorDashboard → doctor
  const menuItems = [
    {
      label: 'Dashboard',
      href: '/doctor',
      icon: LayoutDashboard,
    },
    {
      label: 'My Schedule',
      href: '/doctor/schedule',
      icon: CalendarDays,
    },
    {
      label: 'Appointments',
      href: '/doctor/appointments',
      icon: FileClock,
    },
    {
      label: 'Patients',
      href: '/doctor/findPatients',
      icon: Users,
      submenu: [
        { label: 'My Patients', href: '/doctor/patients' },
        { label: 'Patient Reports', href: '/doctor/patients/reports' },
        { label: 'History Logs', href: '/doctor/patients/history' },
      ]
    },
    {
      label: 'Chat',
      href: '/doctor/chat',
      icon: MessageCircle,
    },
    {
      label: 'Leave Management',
      href: '/doctor/leave/apply',
      icon: ClipboardList,
      submenu: [
        { label: 'Apply Leave', href: '/doctor/leave/apply' },
        { label: 'Leave History', href: '/doctor/leave/history' },
      ]
    },
    {
      label: 'Earnings',
      href: '/doctor/earnings',
      icon: Wallet,
    },
    {
      label: 'Doctor Profile',
      href: '/doctor/profile',
      icon: UserCircle,
    },

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
              <h2 className="text-lg font-bold text-foreground">Doctor Portal</h2>
              <p className="text-xs text-muted-foreground mt-1">Welcome back, Doctor!</p>
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
              const hasSubmenu =
                Array.isArray(item.submenu) && item.submenu.length > 0;
              const isSubmenuOpen = expandedMenu === item.label;

              return (
                <li key={item.label}>
                  <div className="flex items-center">
                    <Button
                      asChild
                      variant={isItemActive ? "secondary" : "ghost"}
                      className={`w-full justify-start ${isItemActive ? "bg-primary/10 text-primary font-semibold" : ""
                        }`}
                      onClick={() => !hasSubmenu && setSidebarOpen(false)}
                    >
                      <Link href={item.href} className="flex items-center gap-3">
                        <IconComponent className="w-5 h-5" />
                        <span>{item.label}</span>
                      </Link>
                    </Button>

                    {hasSubmenu && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          setExpandedMenu(isSubmenuOpen ? null : item.label)
                        }
                        className="h-8 w-8"
                      >
                        <ChevronDown
                          className={`w-4 h-4 transition-transform ${isSubmenuOpen ? 'rotate-180' : ''
                            }`}
                        />
                      </Button>
                    )}
                  </div>

                  {hasSubmenu && isSubmenuOpen && (
                    <ul className="ml-9 mt-1 space-y-1 border-l-2 border-border pl-4">
                      {item.submenu!.map((subitem) => (
                        <li key={subitem.label}>
                          <Button
                            asChild
                            variant={pathname === subitem.href ? "secondary" : "ghost"}
                            size="sm"
                            className={`w-full justify-start text-sm ${pathname === subitem.href ? "bg-primary/10 text-primary font-semibold" : ""
                              }`}
                            onClick={() => setSidebarOpen(false)}
                          >
                            <Link href={subitem.href}>
                              {subitem.label}
                            </Link>
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

      </aside>
    </>
  );
}