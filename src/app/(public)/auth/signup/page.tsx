"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const [role, setRole] = useState<"DOCTOR" | "PATIENT">("DOCTOR");
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "BINARY" | "">("MALE");
  const [loading, setLoading] = useState(false);

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    // Basic client-side checks
    if (!gender) {
      alert("Please select gender.");
      return;
    }
    if (!/^\d{6}$/.test(pinCode)) {
      // simple pincode check (India-style 6 digits)
      alert("Please enter a valid 6-digit pincode.");
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
        alert(data?.error || "Signup failed");
        setLoading(false);
        return;
      }

      if (!data?.user) {
        alert("Signup did not return user data.");
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
    } catch (err: any) {
      console.error("Signup Error:", err);
      alert(err?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 px-4 py-10">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-3xl text-center">Create Your Account</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSignup} className="flex flex-col gap-4" aria-label="signup form">
            <div className="flex flex-col gap-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="Full Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

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

            <div className="flex flex-col gap-2">
              <Label htmlFor="address">Full Address</Label>
              <Input
                id="address"
                type="text"
                placeholder="Full Address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  type="text"
                  placeholder="City"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
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
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="gender">Gender</Label>
              <Select value={gender} onValueChange={(value) => setGender(value as any)} required>
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

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="phone">Mobile Number</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="Mobile Number"
                value={phoneNo}
                onChange={(e) => setPhoneNo(e.target.value)}
                required
              />
            </div>

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
                    onChange={(e) => setRole(e.target.value as any)}
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
                    onChange={(e) => setRole(e.target.value as any)}
                    className="w-4 h-4"
                  />
                  <span>Doctor</span>
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>

            <Button
              type="submit"
              size="lg"
              className="w-full mt-3"
              disabled={loading}
            >
              {loading ? "Creating..." : "Create Account"}
            </Button>
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
    </div>
  );
}
