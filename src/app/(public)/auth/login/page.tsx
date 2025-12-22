"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";





export default function Home() {
  const router = useRouter();
 const setUser = useUserStore((state) => state.setUser);
  const [email, setEmail] = useState("priyanshu@gmail.com");
  const [password, setPassword] = useState("");

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
        alert(data.error || "Login failed");
      }
    } catch (err: any) {
      console.error("Login Error:", err.message);
      alert("Login error: " + err.message);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl">Welcome Back</CardTitle>
          <CardDescription className="text-base">
            Please login to continue
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button type="submit" size="lg" className="w-full mt-2">
              Login
            </Button>
          </form>

          <p className="text-center mt-5 text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Button
              variant="link"
              className="p-0 h-auto"
              onClick={() => router.push("/auth/signup")}
            >
              Signup
            </Button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
