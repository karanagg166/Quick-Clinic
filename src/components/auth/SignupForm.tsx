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
import { showToast } from "@/lib/toast";
import type { UserDetail } from "@/types/common";
import type { SignupFormData } from "@/types/auth";

export function SignupForm() {
    const router = useRouter();
    const setUser = useUserStore((state) => state.setUser);
    const [loading, setLoading] = useState(false);

    const [formData, setFormData] = useState<SignupFormData>({
        name: "doc",
        email: "doc@gmail.com",
        phoneNo: "7869551545",
        age: "45",
        address: "Dumna road",
        city: "Jabalpur",
        state: "Madhya Pradesh",
        pinCode: "482003",
        gender: "MALE",
        password: "12345",
        confirmPassword: "",
        role: "DOCTOR",
    });

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);

    const handleChange = (field: keyof SignupFormData, value: string) => {
        setFormData((prev) => ({ ...prev, [field]: value }));
    };

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.gender) {
            showToast.warning("Please select gender.");
            return;
        }
        if (!/^\d{6}$/.test(formData.pinCode)) {
            showToast.warning("Please enter a valid 6-digit pincode.");
            return;
        }
        if (formData.password !== formData.confirmPassword) {
            showToast.error("Passwords do not match.");
            return;
        }
        if (formData.password.length < 6) {
            showToast.warning("Password must be at least 6 characters long.");
            return;
        }

        setLoading(true);

        try {
            const ageNum = Number(formData.age) || 0;
            const pinNum = Number(formData.pinCode) || 0;

            const response = await fetch("/api/user/signup", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                credentials: "include",
                body: JSON.stringify({
                    ...formData,
                    age: ageNum,
                    pinCode: pinNum,
                }),
            });

            const data = await response.json();
            console.log("Signup Data:", data);

            if (!response.ok) {
                showToast.error(data?.error || "Signup failed");
                setLoading(false);
                return;
            }

            if (!data?.user) {
                showToast.error("Signup did not return user data.");
                setLoading(false);
                return;
            }

            const userDetails: UserDetail = {
                id: data.user.id,
                email: data.user.email,
                phoneNo: data.user.phoneNo ?? "",
                name: data.user.name,
                age: data.user.age,
                gender: data.user.gender,
                role: data.user.role,
                address: data.user.address ?? "",
                city: data.user.city ?? "",
                state: data.user.state ?? "",
                pinCode: data.user.pinCode ?? 0,
                profileImageUrl: data.user.profileImageUrl ?? "",
                emailVerified: data.user.emailVerified ?? false,
                patientId: data.user.patientId ?? null,
                doctorId: data.user.doctorId ?? null,
                adminId: data.user.adminId ?? null,
            };

            console.log("Setting user in store:", userDetails);
            setUser(
                userDetails,
                data.user.patientId ?? null,
                data.user.doctorId ?? null
            );

            if (formData.role === "PATIENT") {
                router.push(`/patient/profile`);
            } else if (formData.role === 'DOCTOR') {
                router.push(`/doctor/profile`);
            } else {
                router.push(`/admin/profile`)
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
                            value={formData.name}
                            onChange={(e) => handleChange("name", e.target.value)}
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
                            value={formData.age}
                            onChange={(e) => handleChange("age", e.target.value)}
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
                            value={formData.address}
                            onChange={(e) => handleChange("address", e.target.value)}
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
                                value={formData.city}
                                onChange={(e) => handleChange("city", e.target.value)}
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
                                value={formData.state}
                                onChange={(e) => handleChange("state", e.target.value)}
                                required
                                className="transition-all focus:scale-[1.01]"
                            />
                        </div>
                    </motion.div>

                    <div className="flex flex-col gap-2">
                        <Label htmlFor="gender">Gender</Label>
                        <Select value={formData.gender} onValueChange={(value) => handleChange("gender", value as any)} required>
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
                            value={formData.email}
                            onChange={(e) => handleChange("email", e.target.value)}
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
                            value={formData.phoneNo}
                            onChange={(e) => handleChange("phoneNo", e.target.value)}
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
                            value={formData.pinCode}
                            onChange={(e) => handleChange("pinCode", e.target.value)}
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
                                    checked={formData.role === "PATIENT"}
                                    onChange={(e) => handleChange("role", e.target.value as any)}
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
                                    checked={formData.role === "DOCTOR"}
                                    onChange={(e) => handleChange("role", e.target.value as any)}
                                    className="w-4 h-4"
                                />
                                <span>Doctor</span>
                            </label>
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="radio"
                                    name="role"
                                    value="ADMIN"
                                    checked={formData.role === "ADMIN"}
                                    onChange={(e) => handleChange("role", e.target.value as any)}
                                    className="w-4 h-4"
                                />
                                <span>Admin</span>
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
                                value={formData.password}
                                onChange={(e) => handleChange("password", e.target.value)}
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
                                value={formData.confirmPassword}
                                onChange={(e) => handleChange("confirmPassword", e.target.value)}
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
    );
}
