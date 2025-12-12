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
  const menuItems = [
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
    {
      label: "Prescriptions",
      href: "/patient/prescriptions",
      icon: FileText,
    },
    {
      label: "Medical Records",
      href: "/patient/records",
      icon: Heart,
    },
    {
      label: "Health History",
      href: "/patient/history",
      icon: Clock,
      submenu: [
        { label: "Allergies", href: "/patient/history/allergies" },
        { label: "Medications", href: "/patient/history/medications" },
        { label: "Surgeries", href: "/patient/history/surgeries" },
      ],
    },
    {
      label: "Settings",
      href: "/patient/settings",
      icon: Settings,
    },
  ];

  return (
    <aside
      className={`fixed top-0 left-0 h-full w-64 bg-white border-r border-gray-200 shadow-lg transform ${
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      } transition-transform duration-300 ease-in-out z-60 overflow-y-auto`}
    >
      {/* Header */}
      <div className="p-6 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Patient Portal</h2>
          <p className="text-xs text-gray-500 mt-1">Welcome back!</p>
        </div>

        <button
          onClick={() => setSidebarOpen(false)}
          className="p-2 hover:bg-gray-100 rounded-lg"
        >
          <X className="w-5 h-5 text-gray-600" />
        </button>
      </div>

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
                  <Link
                    href={item.href}
                    onClick={() => !hasSubmenu && setSidebarOpen(false)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-lg flex-1 transition-colors ${
                      isItemActive
                        ? "bg-blue-100 text-blue-600 font-medium"
                        : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    <IconComponent className="w-5 h-5" />
                    <span className="text-sm">{item.label}</span>
                  </Link>

                  {hasSubmenu && (
                    <button
                      onClick={() =>
                        setExpandedMenu(isSubmenuOpen ? null : item.label)
                      }
                      className="px-2 py-2.5 hover:bg-gray-100 rounded-lg"
                    >
                      <ChevronDown
                        className={`w-4 h-4 text-gray-500 transition-transform ${
                          isSubmenuOpen ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  )}
                </div>

                {hasSubmenu && isSubmenuOpen && (
                  <ul className="ml-9 mt-1 space-y-1 border-l-2 border-gray-200 pl-4">
                    {item.submenu!.map((subitem) => (
                      <li key={subitem.label}>
                        <Link
                          href={subitem.href}
                          onClick={() => setSidebarOpen(false)}
                          className={`text-sm block py-2 px-2 rounded transition-colors ${
                            pathname === subitem.href
                              ? "text-blue-600 font-medium bg-blue-50"
                              : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                          }`}
                        >
                          {subitem.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="p-4 mt-auto border-t border-gray-200">
        <div className="bg-blue-50 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">
            Need Help?
          </h3>
          <p className="text-xs text-gray-600 mb-3">
            Contact our support team for assistance.
          </p>
          <button className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700">
            Contact Support
          </button>
        </div>
      </div>
    </aside>
  );
}
