'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Calendar,
  Stethoscope,
  FileText,
  Settings,
  Heart,
  Clock,
  MessageCircle,
  ChevronDown,
  X
} from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';

interface PatientSidebarProps {
  isSidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
}

export default function PatientSidebar({ isSidebarOpen, setSidebarOpen }: PatientSidebarProps) {
  const pathname = usePathname();
  const [expandedMenu, setExpandedMenu] = useState<string | null>(null);

  const isActive = (href: string) => {
    return pathname === href || pathname.startsWith(href + "/");
  };

  // Updated URLs
  interface MenuItem {
    label: string;
    href: string;
    icon: any;
    submenu?: { label: string; href: string }[];
  }

  const menuItems: MenuItem[] = [
    {
      label: "Dashboard",
      href: "/patient",
      icon: LayoutDashboard,
    },
    {
      label: "My Appointments",
      href: "/patient/appointments",
      icon: Calendar,
    },
    {
      label: "Find Doctors",
      href: "/patient/findDoctors",   // UPDATED
      icon: Stethoscope,
    },
    {
      label: "Chat",
      href: "/patient/chat",          // NEW ITEM
      icon: MessageCircle,
    },



  ];

  return (
    <aside
      className={`fixed top-0 left-0 h-full w-64 bg-card border-r shadow-lg transform ${isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        } transition-transform duration-300 ease-in-out z-[60] overflow-y-auto`}
    >
      {/* Header */}
      <Card className="border-0 border-b rounded-none shadow-none">
        <CardContent className="p-6 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-foreground">Patient Portal</h2>
            <p className="text-xs text-muted-foreground mt-1">Welcome back!</p>
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
                        className={`w-4 h-4 transition-transform ${isSubmenuOpen ? "rotate-180" : ""
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
  );
}