"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore";

interface User {
  userId: string;
  email: string;
  role: string;
  name: string;
  gender: string;
  age: number;
  doctorId?: string | null;
  patientId?: string | null;

}



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

      if (response.ok) {
        // Set user in store with patientId or doctorId based on role
        if (user.role === "DOCTOR") {
          setUser(user, undefined, doctorId);
          router.push("/doctorDashboard");
        } else if (user.role === "PATIENT") {
          setUser(user, patientId, undefined);
          router.push("/patientDashboard");
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
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8">
        
        <h2 className="text-3xl font-bold text-center mb-6 text-gray-800">
          Welcome Back
        </h2>
        <p className="text-center text-gray-500 mb-6">
          Please login to continue
        </p>

        <form onSubmit={handleLogin} className="flex flex-col gap-5">

          {/* Email */}
          <div className="flex flex-col">
            <label className="text-gray-700 font-medium mb-1">Email</label>
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="border border-black text-black placeholder-gray-400 rounded-md px-4 py-2 w-full bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Password */}
          <div className="flex flex-col">
            <label className="text-gray-700 font-medium mb-1">Password</label>
            <input
              type="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="border border-black text-black placeholder-gray-400 rounded-md px-4 py-2 w-full bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          {/* Login Button */}
          <button
            type="submit"
            className="mt-2 w-full bg-blue-600 text-white py-2 rounded-md font-semibold hover:bg-blue-700 transition duration-200"
          >
            Login
          </button>
        </form>

        <p className="text-center mt-5 text-sm text-gray-600">
          Don’t have an account?{" "}
          <span
            className="text-blue-600 font-medium cursor-pointer hover:underline"
            onClick={() => router.push("/user/signup")}
          >
            Signup
          </span>
        </p>
      </div>
    </div>
  );
}
