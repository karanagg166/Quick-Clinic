"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showToast } from "@/lib/toast";
import { useUserStore } from "@/store/userStore";
import { useSocket } from "@/hooks/useSocket";

export default function AdminOnboardingForm() {
    const router = useRouter();
    const { user, setUser } = useUserStore();
    const [loading, setLoading] = useState(false);
    const socket = useSocket();

    const [method, setMethod] = useState<"manager" | "code">("manager");
    const [formData, setFormData] = useState({
        name: user?.name || "",
        phoneNo: user?.phoneNo || "",
        age: user?.age?.toString() || "",
        gender: (user?.gender || "MALE") as "MALE" | "FEMALE" | "BINARY",
        managerEmail: "",
        secretCode: "",
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleGenderChange = (val: string) => {
        setFormData({ ...formData, gender: val as "MALE" | "FEMALE" | "BINARY" });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user?.id) return;

        setLoading(true);
        try {
            const payload = {
                userId: user.id,
                name: formData.name,
                phoneNo: formData.phoneNo,
                age: formData.age,
                gender: formData.gender,
                managerEmail: method === "manager" ? formData.managerEmail : undefined,
                secretCode: method === "code" ? formData.secretCode : undefined,
            };

            const res = await fetch("/api/admin/onboarding", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Onboarding failed");
            }

            if (data.isActive) {
                showToast.success("Account approved! Redirecting to dashboard...");
                router.push("/admin");
            } else {
                // Emit Socket Event if linking to manager
                if (data.managerId && socket) {
                    socket.emit("request_admin_approval", {
                        managerId: data.managerId,
                        requesterId: user.id,
                        name: formData.name
                    });
                }

                showToast.success("Request sent to manager. Waiting for approval.");
                router.push("/admin/profile");
            }

        } catch (error: any) {
            showToast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="w-full max-w-md mx-auto">
            <CardHeader>
                <CardTitle>Complete Your Admin Profile</CardTitle>
                <CardDescription>
                    Enter your details and verify your status to access the dashboard.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="name">Full Name</Label>
                                <Input id="name" name="name" value={formData.name} onChange={handleChange} required />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="age">Age</Label>
                                <Input id="age" name="age" type="number" value={formData.age} onChange={handleChange} required />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="phoneNo">Phone Number</Label>
                            <Input id="phoneNo" name="phoneNo" value={formData.phoneNo} onChange={handleChange} required />
                        </div>

                        <div className="space-y-2">
                            <Label>Gender</Label>
                            <Select value={formData.gender} onValueChange={handleGenderChange}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Select gender" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="MALE">Male</SelectItem>
                                    <SelectItem value="FEMALE">Female</SelectItem>
                                    <SelectItem value="BINARY">Non-Binary</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-3 pt-4 border-t">
                            <Label className="text-base">Verification Method</Label>
                            <RadioGroup defaultValue="manager" onValueChange={(v) => setMethod(v as "manager" | "code")}>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="manager" id="r1" />
                                    <Label htmlFor="r1">Link to Manager (Email)</Label>
                                </div>
                                <div className="flex items-center space-x-2">
                                    <RadioGroupItem value="code" id="r2" />
                                    <Label htmlFor="r2">Super Admin Code</Label>
                                </div>
                            </RadioGroup>
                        </div>

                        {method === "manager" ? (
                            <div className="space-y-2">
                                <Label htmlFor="managerEmail">Manager's Email</Label>
                                <Input
                                    id="managerEmail"
                                    name="managerEmail"
                                    type="email"
                                    placeholder="manager@example.com"
                                    value={formData.managerEmail}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        ) : (
                            <div className="space-y-2">
                                <Label htmlFor="secretCode">Secret Code</Label>
                                <Input
                                    id="secretCode"
                                    name="secretCode"
                                    type="password"
                                    placeholder="Enter code"
                                    value={formData.secretCode}
                                    onChange={handleChange}
                                    required
                                />
                            </div>
                        )}
                    </div>

                    <Button type="submit" className="w-full" disabled={loading}>
                        {loading ? "Submitting..." : "Submit & Verify"}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
