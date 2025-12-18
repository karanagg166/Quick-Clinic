"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store";

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 px-4">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 border border-gray-200">
        <h2 className="text-3xl font-bold text-center mb-6 text-gray-800">
          Create Your Account
        </h2>

        <form onSubmit={handleSignup} className="flex flex-col gap-4" aria-label="signup form">
          <input
            type="text"
            placeholder="Full Name"
            className="inputBox"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            aria-label="Full name"
          />

          <input
            type="number"
            placeholder="Age"
            className="inputBox"
            value={age}
            onChange={(e) => setAge(e.target.value)}
            required
            aria-label="Age"
            min={0}
          />

          <input
            type="text"
            placeholder="Full Address"
            className="inputBox"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            aria-label="Address"
          />

          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="City"
              className="inputBox"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
              aria-label="City"
            />

            <input
              type="text"
              placeholder="State"
              className="inputBox"
              value={stateVal}
              onChange={(e) => setStateVal(e.target.value)}
              required
              aria-label="State"
            />
          </div>

          <div className="flex flex-col">
            <label className="text-gray-700 font-medium mb-1">Gender</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as any)}
              className="border border-black text-black rounded-md px-4 py-2 w-full bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
              aria-label="Gender"
            >
              <option value="" disabled>
                Select gender
              </option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="BINARY">Binary</option>
            </select>
          </div>

          <input
            type="email"
            placeholder="Email"
            className="inputBox"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            aria-label="Email"
          />

          <input
            type="tel"
            placeholder="Mobile Number"
            className="inputBox"
            value={phoneNo}
            onChange={(e) => setPhoneNo(e.target.value)}
            required
            aria-label="Mobile number"
          />

          <input
            type="text"
            placeholder="Pincode"
            className="inputBox"
            value={pinCode}
            onChange={(e) => setPinCode(e.target.value)}
            required
            aria-label="Pincode"
          />

          <div className="mt-2">
            <p className="text-sm font-medium text-gray-700 mb-2">Role</p>
            <div className="flex items-center gap-6">
              <label
                className={`flex items-center gap-2 cursor-pointer ${
                  role === "PATIENT" ? "text-blue-700" : "text-gray-700"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value="PATIENT"
                  checked={role === "PATIENT"}
                  onChange={(e) => setRole(e.target.value as any)}
                  required
                  aria-label="Patient role"
                />
                <span>Patient</span>
              </label>

              <label
                className={`flex items-center gap-2 cursor-pointer ${
                  role === "DOCTOR" ? "text-blue-700" : "text-gray-700"
                }`}
              >
                <input
                  type="radio"
                  name="role"
                  value="DOCTOR"
                  checked={role === "DOCTOR"}
                  onChange={(e) => setRole(e.target.value as any)}
                  aria-label="Doctor role"
                />
                <span>Doctor</span>
              </label>
            </div>
          </div>

          <input
            type="password"
            placeholder="Password"
            className="inputBox"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            aria-label="Password"
          />

          <button
            type="submit"
            className="mt-3 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-all shadow-md hover:shadow-lg disabled:opacity-60"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Creating..." : "Create Account"}
          </button>
        </form>

        <p className="text-center mt-5 text-sm text-gray-600">
          Already have an account?{" "}
          <span
            className="text-blue-600 font-medium cursor-pointer hover:underline"
            onClick={() => router.push("/auth/login")}
            role="button"
            tabIndex={0}
          >
            Login
          </span>
        </p>
      </div>
    </div>
  );
}
