"use client";

import { useEffect, useState } from "react";
import { useUserStore } from "@/store/userStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showToast } from "@/lib/toast";

export default function AdminProfileForm() {
    const { user, updateUser } = useUserStore();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        name: "",
        phoneNo: "",
        age: "",
        gender: "",
        address: "",
        city: "",
        state: "",
        // Read-only or hidden
        email: "",
    });

    useEffect(() => {
        if (user) {
            setFormData({
                name: user.name,
                phoneNo: user.phoneNo || "",
                age: user.age ? user.age.toString() : "",
                gender: user.gender || "MALE",
                address: user.address || "",
                city: user.city || "",
                state: user.state || "",
                email: user.email,
            });
        }
    }, [user]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleGenderChange = (val: string) => {
        setFormData({ ...formData, gender: val });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        setLoading(true);
        try {
            const payload = {
                name: formData.name,
                phoneNo: formData.phoneNo,
                age: formData.age,
                gender: formData.gender,
                address: formData.address,
                city: formData.city,
                state: formData.state,
                // Add validation/cleaning logic here if needed
            };

            const res = await fetch(`/api/user/${user.id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "Failed to update profile");
            }

            // Update store
            updateUser(data);
            showToast.success("Profile updated successfully");
        } catch (error: any) {
            console.error(error);
            showToast.error(error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>My Profile</CardTitle>
                <CardDescription>View and update your personal information.</CardDescription>
            </CardHeader>
            <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="email">Email (Read-only)</Label>
                            <Input id="email" value={formData.email} disabled className="bg-muted" />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="role">Role (Read-only)</Label>
                            <Input id="role" value={user?.role || ""} disabled className="bg-muted" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="name">Full Name</Label>
                            <Input id="name" name="name" value={formData.name} onChange={handleChange} required />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="phoneNo">Phone Number</Label>
                            <Input id="phoneNo" name="phoneNo" value={formData.phoneNo} onChange={handleChange} />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="age">Age</Label>
                            <Input id="age" name="age" type="number" value={formData.age} onChange={handleChange} />
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
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="address">Address</Label>
                        <Input id="address" name="address" value={formData.address} onChange={handleChange} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="city">City</Label>
                            <Input id="city" name="city" value={formData.city} onChange={handleChange} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="state">State</Label>
                            <Input id="state" name="state" value={formData.state} onChange={handleChange} />
                        </div>
                    </div>

                    <div className="flex justify-end">
                        <Button type="submit" disabled={loading}>
                            {loading ? "Saving..." : "Save Changes"}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    );
}
