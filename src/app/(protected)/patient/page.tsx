"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { CalendarDays, UserPlus, MessageCircle, FileText, Stethoscope, HeartPulse, Clock3, TrendingUp } from "lucide-react";
import { useUserStore } from "@/store/userStore";
import UpcomingAppointmentsSection from "@/components/patient/upcomingAppointmentsSection";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface StatsData {
  upcomingAppointments: number;
  assignedDoctors: number;
  pendingApprovals: number;
  wellnessScore: number;
}

export default function PatientDashboard() {
  const { user, patientId } = useUserStore();
  const [statsData, setStatsData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!patientId) {
      setLoading(false);
      return;
    }

    const fetchStats = async () => {
      try {
        const res = await fetch(`/api/patients/${patientId}/stats`);
        if (res.ok) {
          const data = await res.json();
          setStatsData(data);
        }
      } catch (error) {
        console.error("Failed to fetch stats:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [patientId]);

  const stats = [
    { 
      label: "Upcoming Appointments", 
      value: loading ? "--" : statsData?.upcomingAppointments.toString() || "0", 
      icon: CalendarDays, 
      bgColor: "bg-emerald-50", 
      textColor: "text-emerald-600" 
    },
    { 
      label: "Assigned Doctors", 
      value: loading ? "--" : statsData?.assignedDoctors.toString() || "0", 
      icon: Stethoscope, 
      bgColor: "bg-blue-50", 
      textColor: "text-blue-600" 
    },
    { 
      label: "Pending Approvals", 
      value: loading ? "--" : statsData?.pendingApprovals.toString() || "0", 
      icon: Clock3, 
      bgColor: "bg-amber-50", 
      textColor: "text-amber-600" 
    },
    { 
      label: "Wellness Score", 
      value: loading ? "--" : `${statsData?.wellnessScore || 0}/100`, 
      icon: HeartPulse, 
      bgColor: "bg-rose-50", 
      textColor: "text-rose-600" 
    },
  ];

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Hero */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="border shadow-sm hover:shadow-md transition-shadow">
          <CardContent className="p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p className="text-sm text-muted-foreground font-medium">Welcome back</p>
                <h1 className="text-2xl md:text-3xl font-bold leading-tight mt-1 bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text">
                  {user?.name || "Patient"}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">Track your health, appointments, and care in one place.</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button asChild variant="outline" size="sm" className="group">
                  <Link href="/patient/findDoctors">
                    <Stethoscope className="w-4 h-4 mr-2 group-hover:rotate-12 transition-transform" /> Find Doctors
                  </Link>
                </Button>
                <Button asChild size="sm" className="group">
                  <Link href="/patient/appointments">
                    <CalendarDays className="w-4 h-4 mr-2 group-hover:rotate-12 transition-transform" /> View Appointments
                  </Link>
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((card, index) => (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1, duration: 0.4 }}
          >
            <Card className="border shadow-sm hover:shadow-md transition-all hover:scale-[1.02] cursor-pointer">
              <CardContent className="p-5 flex items-start gap-3">
                <motion.div
                  whileHover={{ scale: 1.1, rotate: 5 }}
                  className={`p-2.5 rounded-lg ${card.bgColor} ${card.textColor}`}
                >
                  <card.icon className="w-5 h-5" />
                </motion.div>
                <div className="flex-1">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">{card.label}</p>
                  {loading ? (
                    <Skeleton className="h-8 w-20 mt-1" />
                  ) : (
                    <p className="text-2xl font-bold mt-1 text-foreground">{card.value}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Upcoming section */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="xl:col-span-2"
        >
          <Card className="border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-bold">Upcoming Appointments</CardTitle>
                  <CardDescription className="mt-1">Your scheduled visits and follow-ups</CardDescription>
                </div>
                <Button asChild variant="link" className="h-auto p-0 font-semibold">
                  <Link href="/patient/appointments" className="flex items-center gap-1">
                    View all
                    <CalendarDays className="w-4 h-4" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <UpcomingAppointmentsSection />
            </CardContent>
          </Card>
        </motion.div>

        {/* Quick actions / recent activity */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.5, duration: 0.5 }}
          className="space-y-6"
        >
          <Card className="border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Quick Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                { href: "/patient/findDoctors", icon: UserPlus, title: "Find a doctor", desc: "Browse specializations and availability", color: "text-blue-600" },
                { href: "/patient/chat", icon: MessageCircle, title: "Open chat", desc: "Message your doctor", color: "text-emerald-600" },
              ].map((action, index) => (
                <motion.div
                  key={action.href}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.6 + index * 0.1 }}
                >
                  <Button asChild variant="ghost" className="w-full justify-start hover:bg-accent/50 transition-colors">
                    <Link href={action.href}>
                      <action.icon className={`w-5 h-5 mr-3 ${action.color}`} />
                      <div className="text-left">
                        <p className="font-semibold text-sm">{action.title}</p>
                        <p className="text-xs text-muted-foreground">{action.desc}</p>
                      </div>
                    </Link>
                  </Button>
                </motion.div>
              ))}
            </CardContent>
          </Card>

          <Card className="border shadow-sm hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle className="text-lg font-bold">Recent Activity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {["Appointment confirmed", "Prescription added", "Lab results updated"].map((item, index) => (
                <motion.div
                  key={item}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 + index * 0.1 }}
                  className="flex items-center gap-3 p-3 rounded-lg hover:bg-accent transition-colors cursor-pointer"
                >
                  <FileText className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="font-semibold text-sm">{item}</p>
                    <p className="text-xs text-muted-foreground">Just now</p>
                  </div>
                </motion.div>
              ))}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
