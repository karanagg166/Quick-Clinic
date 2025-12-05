"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Signup() {
  const router = useRouter();

  const [name, setName] = useState("karan");
  const [email, setEmail] = useState("");
  const [phoneNo, setPhoneNo] = useState("");
  const [age, setAge] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("");
  const [gender, setGender] = useState(""); // NEW

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/auth/signup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          phoneNo,
          age,
          city,
          state,
          pinCode,
          password,
          role,
          gender
        }),
      });

      const data = await response.json();

      if (response.ok) {
       router.push("/user/login");
      } else {
        alert(data.error || "Signup failed");
      }
    } catch (err: any) {
      console.error("Signup Error:", err.message);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 px-4">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 border border-gray-200">

        <h2 className="text-3xl font-bold text-center mb-6 text-gray-800">
          Create Your Account
        </h2>

        <form onSubmit={handleSignup} className="flex flex-col gap-4">

          <input
            type="text"
            placeholder="Full Name"
            className="inputBox"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="Age"
              className="inputBox"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              required
            />

            <input
              type="text"
              placeholder="City"
              className="inputBox"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              required
            />
          </div>

          {/* Gender */}
          <div className="flex flex-col">
            <label className="text-gray-700 font-medium mb-1">Gender</label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value)}
              className="border border-black text-black rounded-md px-4 py-2 w-full bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none"
              required
            >
              <option value="" disabled>Select gender</option>
              <option value="MALE">Male</option>
              <option value="FEMALE">Female</option>
              <option value="OTHER">Other</option>
            </select>
          </div>

          <input
            type="email"
            placeholder="Email"
            className="inputBox"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <input
            type="text"
            placeholder="Mobile Number"
            className="inputBox"
            value={phoneNo}
            onChange={(e) => setPhoneNo(e.target.value)}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <input
              type="text"
              placeholder="State"
              className="inputBox"
              value={state}
              onChange={(e) => setState(e.target.value)}
              required
            />

            <input
              type="text"
              placeholder="Pincode"
              className="inputBox"
              value={pinCode}
              onChange={(e) => setPinCode(e.target.value)}
              required
            />
          </div>

          {/* Role */}
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
                  onChange={(e) => setRole(e.target.value)}
                  required
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
                  onChange={(e) => setRole(e.target.value)}
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
          />

          <button
            type="submit"
            className="mt-3 bg-blue-600 text-white py-3 rounded-xl font-semibold 
                       hover:bg-blue-700 transition-all shadow-md hover:shadow-lg"
          >
            Create Account
          </button>
        </form>

        <p className="text-center mt-5 text-sm text-gray-600">
          Already have an account?{" "}
          <span
            className="text-blue-600 font-medium cursor-pointer hover:underline"
            onClick={() => router.push("/user/login")}
          >
            Login
          </span>
        </p>

      </div>
    </div>
  );
}
