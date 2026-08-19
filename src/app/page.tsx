"use client";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Stethoscope, ArrowRight, LogIn, LayoutDashboard } from "lucide-react";
import ParticlesBackground from "@/components/general/Particles";
import Footer from "@/components/general/Footer";

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

  return (
    <div className="relative flex min-h-screen flex-col bg-background overflow-x-hidden">
      <ParticlesBackground />

      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="w-full max-w-md my-auto"
        >
          <Card className="border shadow-lg backdrop-blur-sm bg-card/95">
            <CardHeader className="space-y-4 text-center">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
                className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center"
              >
                <Stethoscope className="w-8 h-8 text-primary" />
              </motion.div>
              <CardTitle className="text-3xl font-bold tracking-tight">
                Welcome to QuickClinic
              </CardTitle>
              <CardDescription className="text-base">
                Your trusted healthcare companion. Connect with doctors, manage appointments, and access quality care.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {hasHydrated && user ? (
                <>
                  <motion.div
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.3 }}
                  >
                    <Button
                      onClick={handleDashboard}
                      size="lg"
                      className="w-full group bg-emerald-600 hover:bg-emerald-700 text-white"
                    >
                      <LayoutDashboard className="w-4 h-4 mr-2" />
                      Go to {user.role === 'DOCTOR' ? 'Doctor' : user.role === 'ADMIN' ? 'Admin' : 'Patient'} Dashboard
                      <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </motion.div>
                  <Button
                    onClick={handleLogin}
                    variant="outline"
                    size="sm"
                    className="w-full text-xs text-muted-foreground"
                  >
                    Switch Account / Sign In Again
                  </Button>
                </>
              ) : (
                <>
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.4 }}
                  >
                    <Button
                      onClick={handleLogin}
                      size="lg"
                      className="w-full group"
                    >
                      <LogIn className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" />
                      Login
                    </Button>
                  </motion.div>
                  <motion.div
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.5 }}
                  >
                    <Button
                      onClick={handleSignup}
                      variant="outline"
                      size="lg"
                      className="w-full group"
                    >
                      Get Started
                      <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </motion.div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </main>

      <div className="relative z-10 w-full mt-auto">
        <Footer />
      </div>
    </div>
  );
}
