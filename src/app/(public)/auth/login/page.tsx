"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, LogIn, Mail, Lock } from "lucide-react";
import dynamic from "next/dynamic";
import { showToast } from "@/lib/toast";

const ParticlesBackground = dynamic(
  () => import("@/components/general/Particles"),
  { ssr: false }
);





export default function Home() {
  const router = useRouter();
  const setUser = useUserStore((state) => state.setUser);
  const [email, setEmail] = useState("patient@gmail.com");
  const [password, setPassword] = useState("karan166");
  const [showPassword, setShowPassword] = useState(false);

  const handleRoleSelect = (roleEmail: string) => {
    setEmail(roleEmail);
    setPassword("karan166");
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      const response = await fetch("/api/user/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const data = await response.json();

      const { user, patientId, doctorId } = data;
      console.log("Login Response:", data);
      console.log("user from Login Response:", user);

      if (response.ok) {
        // Set user in store with patientId or doctorId based on role
        if (user.role === "DOCTOR") {
          setUser(user, undefined, doctorId);
          router.push("/doctor");
        } else if (user.role === "PATIENT") {
          setUser(user, patientId, undefined);
          router.push("/patient");
        } else if (user.role === "ADMIN") {
          setUser(user);
          router.push("/admin");
        }
      } else {
        showToast.error(data.error || "Login failed");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An unknown error occurred";
      console.error("Login Error:", errorMessage);
      showToast.error("Login error: " + errorMessage);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4 py-10 overflow-hidden">
      <ParticlesBackground />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-md"
      >
        <Card className="border shadow-lg backdrop-blur-sm bg-card/95">
          <CardHeader className="text-center space-y-2">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2"
            >
              <LogIn className="w-6 h-6 text-primary" />
            </motion.div>
            <CardTitle className="text-3xl font-bold tracking-tight">Welcome Back</CardTitle>
            <CardDescription className="text-base">
              Select your role or enter credentials to sign in
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Quick Role Selector */}
            <div className="grid grid-cols-3 gap-2 p-1.5 bg-muted/60 rounded-xl mb-5 border">
              <button
                type="button"
                onClick={() => handleRoleSelect("patient@gmail.com")}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 transition-all ${
                  email === "patient@gmail.com"
                    ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                }`}
              >
                <span className="text-base">🩺</span>
                <span>Patient</span>
              </button>
              <button
                type="button"
                onClick={() => handleRoleSelect("doctor@gmail.com")}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 transition-all ${
                  email === "doctor@gmail.com"
                    ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                }`}
              >
                <span className="text-base">👨‍⚕️</span>
                <span>Doctor</span>
              </button>
              <button
                type="button"
                onClick={() => handleRoleSelect("admin@gmail.com")}
                className={`py-2 px-2.5 rounded-lg text-xs font-semibold flex flex-col items-center gap-1 transition-all ${
                  email === "admin@gmail.com"
                    ? "bg-primary text-primary-foreground shadow-sm scale-[1.02]"
                    : "text-muted-foreground hover:text-foreground hover:bg-background/60"
                }`}
              >
                <span className="text-base">🛡️</span>
                <span>Admin</span>
              </button>
            </div>

            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 }}
                className="flex flex-col gap-2"
              >
                <Label htmlFor="email" className="flex items-center gap-2">
                  <Mail className="w-4 h-4" />
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="transition-all focus:scale-[1.02]"
                />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 }}
                className="flex flex-col gap-2"
              >
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock className="w-4 h-4" />
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="pr-10 transition-all focus:scale-[1.02]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
              >
                <Button type="submit" size="lg" className="w-full mt-2 group">
                  <LogIn className="w-4 h-4 mr-2 group-hover:translate-x-1 transition-transform" />
                  Login
                </Button>
              </motion.div>
            </form>

            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-center mt-5 text-sm text-muted-foreground"
            >
              Don&apos;t have an account?{" "}
              <Button
                variant="link"
                className="p-0 h-auto font-semibold"
                onClick={() => router.push("/auth/signup")}
              >
                Sign up
              </Button>
            </motion.p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
