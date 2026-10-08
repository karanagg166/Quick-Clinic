"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Stethoscope,
  ArrowRight,
  LogIn,
  LayoutDashboard,
  CalendarDays,
  MessageCircle,
  FileText,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import ParticlesBackground from "@/components/general/Particles";
import Footer from "@/components/general/Footer";
import Logo from "@/components/general/Logo";

export default function Home() {
  const router = useRouter();
  const { user, hasHydrated } = useUserStore();

  const dashboardHref =
    user?.role === "DOCTOR"
      ? "/doctor"
      : user?.role === "ADMIN"
      ? "/admin"
      : "/patient";

  const handleSignup = () => {
    router.push("/auth/signup");
  };

  const handleLogin = () => {
    router.push("/auth/login");
  };

  const handleDashboard = () => {
    router.push(dashboardHref);
  };

  const features = [
    {
      icon: Stethoscope,
      title: "Doctor Discovery",
      description:
        "Browse verified healthcare practitioners by specialty, consultation fees, and schedule availability.",
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-500/10",
    },
    {
      icon: CalendarDays,
      title: "Appointment Management",
      description:
        "Book consultation slots with real-time availability holds, calendar sync, and status tracking.",
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-500/10",
    },
    {
      icon: LayoutDashboard,
      title: "Dedicated Dashboards",
      description:
        "Tailored command centers for patients to track visits, doctors to manage slots, and admins to oversee operations.",
      color: "text-indigo-600 dark:text-indigo-400",
      bg: "bg-indigo-500/10",
    },
    {
      icon: MessageCircle,
      title: "Doctor-Patient Communication",
      description:
        "Authorized in-platform messaging between patients and their assigned doctors for coordinated care.",
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-500/10",
    },
    {
      icon: FileText,
      title: "Medical Document Records",
      description:
        "Securely upload, organize, and view clinical records, prescriptions, and diagnostic reports.",
      color: "text-rose-600 dark:text-rose-400",
      bg: "bg-rose-500/10",
    },
    {
      icon: ShieldCheck,
      title: "Role-Specific Workflows",
      description:
        "Rigorous access controls ensuring patient data privacy, doctor schedule governance, and administrative audit logs.",
      color: "text-cyan-600 dark:text-cyan-400",
      bg: "bg-cyan-500/10",
    },
  ];

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground overflow-x-hidden">
      <ParticlesBackground />

      {/* Top Navigation */}
      <header className="relative z-20 border-b bg-background/80 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <Logo />
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/about"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5"
            >
              About
            </Link>

            {hasHydrated && user ? (
              <Button
                onClick={handleDashboard}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"
              >
                <LayoutDashboard className="w-4 h-4 mr-1.5" />
                Dashboard
              </Button>
            ) : (
              <>
                <Button
                  onClick={handleLogin}
                  variant="ghost"
                  size="sm"
                  className="text-sm"
                >
                  <LogIn className="w-4 h-4 mr-1.5" />
                  Sign In
                </Button>
                <Button
                  onClick={handleSignup}
                  size="sm"
                  className="bg-primary text-primary-foreground shadow-sm"
                >
                  <UserPlus className="w-4 h-4 mr-1.5" />
                  Get Started
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 flex-1">
        <section className="px-4 py-16 sm:py-20 lg:py-24 max-w-5xl mx-auto text-center space-y-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-4"
          >
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-muted/60 text-xs font-semibold text-primary mb-2">
              <Stethoscope className="w-3.5 h-3.5" />
              Comprehensive Digital Healthcare Platform
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight">
              Modern Healthcare,{" "}
              <span className="bg-gradient-to-r from-blue-600 via-emerald-600 to-indigo-600 bg-clip-text text-transparent">
                Connected Care
              </span>
            </h1>

            <p className="max-w-2xl mx-auto text-base sm:text-lg text-muted-foreground leading-relaxed">
              Discover verified doctors, book and manage consultations, access clinical documents,
              and communicate seamlessly through secure role-based portals.
            </p>
          </motion.div>

          {/* Action Card / Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2"
          >
            {hasHydrated && user ? (
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                <Button
                  onClick={handleDashboard}
                  size="lg"
                  className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white shadow-md group px-6"
                >
                  <LayoutDashboard className="w-4 h-4 mr-2" />
                  Go to {user.role === "DOCTOR" ? "Doctor" : user.role === "ADMIN" ? "Admin" : "Patient"} Dashboard
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  onClick={handleLogin}
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto text-muted-foreground hover:text-foreground"
                >
                  Switch Account
                </Button>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
                <Button
                  onClick={handleSignup}
                  size="lg"
                  className="w-full sm:w-auto px-8 shadow-md group"
                >
                  <UserPlus className="w-4 h-4 mr-2" />
                  Get Started
                  <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                </Button>
                <Button
                  onClick={handleLogin}
                  variant="outline"
                  size="lg"
                  className="w-full sm:w-auto px-8"
                >
                  <LogIn className="w-4 h-4 mr-2" />
                  Sign In
                </Button>
              </div>
            )}
          </motion.div>
        </section>

        {/* Platform Capabilities Section */}
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 lg:py-16">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">
              Designed for Patients, Doctors, and Administrators
            </h2>
            <p className="text-sm sm:text-base text-muted-foreground">
              Everything needed to manage medical consultations and clinic operations in one unified environment.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, i) => {
              const Icon = feature.icon;
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 * i, duration: 0.4 }}
                >
                  <Card className="h-full border bg-card/90 backdrop-blur-sm hover:shadow-md transition-all hover:scale-[1.01]">
                    <CardHeader className="space-y-3 pb-3">
                      <div className={`w-12 h-12 rounded-xl ${feature.bg} ${feature.color} flex items-center justify-center`}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <CardTitle className="text-lg font-semibold">{feature.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CardDescription className="text-sm leading-relaxed text-muted-foreground">
                        {feature.description}
                      </CardDescription>
                    </CardContent>
                  </Card>
                </motion.div>
              );
            })}
          </div>
        </section>
      </main>

      {/* Footer */}
      <div className="relative z-10 w-full mt-auto">
        <Footer />
      </div>
    </div>
  );
}
