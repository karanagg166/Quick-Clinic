"use client";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Stethoscope, ArrowRight, LogIn } from "lucide-react";
import ParticlesBackground from "@/components/general/Particles";
import Footer from "@/components/general/Footer";

export default function Home() {
  const router = useRouter();

  const handleSignup = () => {
    router.push("/auth/signup");
  };

  const handleLogin = () => {
    router.push("/auth/login");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10 overflow-hidden">
      <ParticlesBackground />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="relative z-10 w-full max-w-md"
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
          </CardContent>
        </Card>
      </motion.div>
      <div className="absolute bottom-0 w-full">
        <Footer />
      </div>
    </div>
  );
}
