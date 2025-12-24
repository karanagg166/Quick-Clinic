"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { useUserStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Eye, EyeOff, UserPlus, Mail, Phone, MapPin, Lock, User } from "lucide-react";
import ParticlesBackground from "@/components/general/Particles";
import { showToast } from "@/lib/toast";

export default function Signup() {
  const router = useRouter();
  const setUser = useUserStore((state) => state.setUser);

  // form state (strings for inputs; parse to numbers before sending if required)
  const [name, setName] = useState<string>("doc");
  const [email, setEmail] = useState<string>("doc@gmail.com");
  const [phoneNo, setPhoneNo] = useState<string>("7869551545");
  const [age, setAge] = useState<string>("45");
  const [address, setAddress] = useState<string>("Dumna road");
  const [city, setCity] = useState<string>("Jabalpur");
  const [stateVal, setStateVal] = useState<string>("Madhya Pradesh"); // rename to avoid keyword
  const [pinCode, setPinCode] = useState<string>("482003");
  const [password, setPassword] = useState<string>("12345");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [role, setRole] = useState<"DOCTOR" | "PATIENT">("DOCTOR");
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "BINARY" | "">("MALE");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic client-side checks
    if (!gender) {
      showToast.warning("Please select gender.");
      return;
    }
    if (!/^\d{6}$/.test(pinCode)) {
      // simple pincode check (India-style 6 digits)
      showToast.warning("Please enter a valid 6-digit pincode.");
      return;
    }
    if (password !== confirmPassword) {
      showToast.error("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      showToast.warning("Password must be at least 6 characters long.");
      return;
    }

    setLoading(true);

    try {
      // Cast numeric fields to numbers
      const ageNum = Number(age) || 0;
      const pinNum = Number(pinCode) || 0;

      const response = await fetch("/api/user/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          name,
          email,
          phoneNo,
          age: ageNum,
          address,
          city,
          state: stateVal,
          pinCode: pinNum,
          password,
          role,
          gender,
        }),
      });

      const data = await response.json();
      console.log("Signup Data:", data);

      if (!response.ok) {
        // server returned an error status
        showToast.error(data?.error || "Signup failed");
        setLoading(false);
        return;
      }

      if (!data?.user) {
        showToast.error("Signup did not return user data.");
        setLoading(false);
        return;
      }
    //  console.log(data);
      // Map server response -> local store User type (includes isVerified/phone/profileImageUrl)
      const userDetails = {
        userId: data.user.userId,
        email: data.user.email,
        role: data.user.role,
        name: data.user.name,
        gender: data.user.gender,
        age: data.user.age,
        phoneNo: data.user.phoneNo ?? "",
        profileImageUrl: data.user.profileImageUrl ?? "",
        isVerified: data.user.emailVerified ?? false,
      };

      // persist to zustand with optional ids
      console.log("Setting user in store:", userDetails);
      setUser(
        userDetails,
        data.user.patientId ?? null,
        data.user.doctorId ?? null
      );

      // navigate based on role
      if (role === "PATIENT") {
        router.push(`/user/profile/patient`);
      } else {
        router.push(`/user/profile/doctor`);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "An unexpected error occurred";
      console.error("Signup Error:", errorMessage);
      showToast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-10 overflow-hidden">
      <ParticlesBackground />
      
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-2xl"
      >
        <Card className="border shadow-lg backdrop-blur-sm bg-card/95">
          <CardHeader className="text-center space-y-2">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring" }}
              className="mx-auto w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-2"
            >
              <UserPlus className="w-8 h-8 text-primary" />
            </motion.div>
            <CardTitle className="text-3xl font-bold tracking-tight">Create Your Account</CardTitle>
          </CardHeader>
          <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4" aria-label="signup form">
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="name" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Full Name
              </Label>
              <Input
                id="name"
                type="text"
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="transition-all focus:scale-[1.01]"
              />
            </motion.div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="age">Age</Label>
              <Input
                id="age"
                type="number"
                placeholder="Age"
                value={age}
                onChange={(e) => setAge(e.target.value)}
                required
                min={0}
              />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="address" className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                Full Address
              </Label>
              <Input
                id="address"
                type="text"
                placeholder="Full Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
                className="transition-all focus:scale-[1.01]"
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.55 }}
              className="grid grid-cols-2 gap-4"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  type="text"
                  placeholder="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                  className="transition-all focus:scale-[1.01]"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  type="text"
                  placeholder="State"
                  value={stateVal}
                  onChange={(e) => setStateVal(e.target.value)}
                  required
                  className="transition-all focus:scale-[1.01]"
                />
              </div>
            </motion.div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={gender} onValueChange={(value) => setGender(value as "MALE" | "FEMALE" | "BINARY")} required>
                <SelectTrigger id="gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">Male</SelectItem>
                  <SelectItem value="FEMALE">Female</SelectItem>
                  <SelectItem value="BINARY">Binary</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="transition-all focus:scale-[1.01]"
              />
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="phone" className="flex items-center gap-2">
                <Phone className="w-4 h-4" />
                Mobile Number
              </Label>
              <Input
                id="phone"
                type="tel"
                placeholder="Mobile Number"
                value={phoneNo}
                onChange={(e) => setPhoneNo(e.target.value)}
                required
                className="transition-all focus:scale-[1.01]"
              />
            </motion.div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pinCode">Pincode</Label>
              <Input
                id="pinCode"
                type="text"
                placeholder="Pincode"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Role</Label>
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    value="PATIENT"
                    checked={role === "PATIENT"}
                    onChange={(e) => setRole(e.target.value as "DOCTOR" | "PATIENT")}
                    required
                    className="w-4 h-4"
                  />
                  <span>Patient</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="role"
                    value="DOCTOR"
                    checked={role === "DOCTOR"}
                    onChange={(e) => setRole(e.target.value as "DOCTOR" | "PATIENT")}
                    className="w-4 h-4"
                  />
                  <span>Doctor</span>
                </label>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
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
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="pr-10 transition-all focus:scale-[1.01]"
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
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.65 }}
              className="flex flex-col gap-2"
            >
              <Label htmlFor="confirmPassword" className="flex items-center gap-2">
                <Lock className="w-4 h-4" />
                Confirm Password
              </Label>
              <div className="relative">
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  className="pr-10 transition-all focus:scale-[1.01]"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showConfirmPassword ? "Hide password" : "Show password"}
                >
                  {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
            >
              <Button
                type="submit"
                size="lg"
                className="w-full mt-3 group"
                disabled={loading}
              >
                {loading ? (
                  "Creating..."
                ) : (
                  <>
                    <UserPlus className="w-4 h-4 mr-2 group-hover:rotate-12 transition-transform" />
                    Create Account
                  </>
                )}
              </Button>
            </motion.div>
          </form>

          <p className="text-center mt-5 text-sm text-muted-foreground">
            Already have an account?{" "}
            <Button
              variant="link"
              className="p-0 h-auto"
              onClick={() => router.push("/auth/login")}
            >
              Login
            </Button>
          </p>
        </CardContent>
      </Card>
      </motion.div>
    </div>
  );
}
