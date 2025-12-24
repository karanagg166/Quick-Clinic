"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore";
import AvatarUploader from "@/components/general/AvatarUploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";

export default function UpdateProfile() {
  const router = useRouter();
  
  // Get current user and setter from store
  const { user, setUser, patientId, doctorId } = useUserStore();
  const userId = user?.userId;
  const isVerified = user?.isVerified ?? false;
  // Loading states
  const [loadingData, setLoadingData] = useState(true);
  const [updating, setUpdating] = useState(false);

  // Unified form state
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phoneNo: "",
    age: "",
    address: "",
    city: "",
    state: "",
    pinCode: "",
    gender: "",
    role: "",
  });

  // 1. Fetch User Data on Mount
  useEffect(() => {
    // If no user in store, redirect to login
    // if (!user?.userId) {
    //   router.push("/user/login");
    //   return;
    // }
    console.log(userId);

    const fetchUserData = async () => {
      if(!userId) {
        return ;
      }
      try {
        const response = await fetch(`/api/user/${userId}`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
        });

        if (!response.ok) {
          throw new Error("Failed to fetch user data");
        }

        const data = await response.json();
        console.log("Fetched profile data:", data);
        // Populate form with fetched data
        // We use || "" to ensure inputs don't become uncontrolled if value is null
        setFormData({
            name: data.name || "",
            email: data.email || "",
            phoneNo: data.phoneNo || "",
            age: data.age?.toString() || "",
            address: data.address || "",
            city: data.city || "",
            state: data.state || "",
            pinCode: data.pinCode?.toString() || "",
            gender: data.gender || "",
            role: data.role || "",
        });
      } catch (error) {
        console.error("Error fetching profile:", error);
        
      } finally {
        setLoadingData(false);
      }
    };

    fetchUserData();
  }, [userId]);

  // 2. Handle Input Changes
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  // 3. Handle Update Submission
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setUpdating(true);

    try {
        // Validate Pincode
        if (!/^\d{6}$/.test(formData.pinCode)) {
            showToast.warning("Please enter a valid 6-digit pincode.");
            setUpdating(false);
            return;
        }

      const response = await fetch(`/api/user/${user?.userId}`, {
        method: "PATCH", // Using PATCH for partial updates
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: formData.name,
          phoneNo: formData.phoneNo,
          age: Number(formData.age),
          address: formData.address,
          city: formData.city,
          state: formData.state,
          pinCode: Number(formData.pinCode),
          gender: formData.gender,
          // Note: Usually we don't update Role or Email here unless backend supports it
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Update failed");
      }

      showToast.success("Profile updated successfully!");

      // 4. Update the local Zustand store with new data
      // We merge existing user object with the updated fields
          if (user) {
            const updatedUser = {
              ...user,
              name: formData.name,
              age: Number(formData.age),
              gender: formData.gender as "MALE" | "FEMALE" | "BINARY",
            };
              setUser(updatedUser, patientId ?? undefined, doctorId ?? undefined);
          }

      // Redirect back to profile dashboard
      const dashboardRoute = formData.role === "PATIENT" ? "/user/profile/patient" : "/user/profile/doctor";
      router.push(dashboardRoute);

    } catch (err: any) {
      console.error("Update Error:", err);
      showToast.error(err.message || "Something went wrong.");
    } finally {
      setUpdating(false);
    }
  };

  if (loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="space-y-4 w-full max-w-md">
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <Card className="w-full max-w-md shadow-sm">
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Update Profile</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              Cancel
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar section */}
          {userId && (
            <div>
              <AvatarUploader userId={userId} initialUrl={user?.profileImageUrl} />
            </div>
          )}

          {/* Email verification */}
          <Card>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">Email verification</p>
                <p className="text-xs text-muted-foreground">{formData.email || user?.email}</p>
              </div>
              {isVerified ? (
                <Badge variant="default" className="bg-green-100 text-green-700">Verified</Badge>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => router.push("/user/verify")}
                >
                  Verify Email
                </Button>
              )}
            </CardContent>
          </Card>

          <form onSubmit={handleUpdate} className="flex flex-col gap-4">
            {/* Read-Only Role Display */}
            <Card>
              <CardContent className="p-3 flex justify-between items-center">
                <span className="text-sm font-medium">Account Type:</span>
                <Badge variant="secondary">{formData.role}</Badge>
              </CardContent>
            </Card>

            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                name="name"
                value={formData.name}
                onChange={handleChange}
                required
              />
            </div>

            <div className="flex gap-4">
              <div className="w-1/3 flex flex-col gap-2">
                <Label htmlFor="age">Age</Label>
                <Input
                  id="age"
                  type="number"
                  name="age"
                  value={formData.age}
                  onChange={handleChange}
                  required
                  min={0}
                />
              </div>
              <div className="w-2/3 flex flex-col gap-2">
                <Label htmlFor="gender">Gender</Label>
                <Select
                  name="gender"
                  value={formData.gender}
                  onValueChange={(value) => handleChange({ target: { name: "gender", value } } as any)}
                  required
                >
                  <SelectTrigger id="gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="BINARY">Binary</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="address">Address</Label>
              <Input
                id="address"
                type="text"
                name="address"
                value={formData.address}
                onChange={handleChange}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  type="text"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  type="text"
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                name="email"
                value={formData.email}
                disabled
                className="bg-muted cursor-not-allowed"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="phoneNo">Mobile Number</Label>
              <Input
                id="phoneNo"
                type="tel"
                name="phoneNo"
                value={formData.phoneNo}
                onChange={handleChange}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="pinCode">Pincode</Label>
              <Input
                id="pinCode"
                type="text"
                name="pinCode"
                value={formData.pinCode}
                onChange={handleChange}
                required
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full mt-4"
              disabled={updating}
            >
              {updating ? "Updating..." : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}