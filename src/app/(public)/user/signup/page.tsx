"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function Signup() {
  const router = useRouter();

  const [Name, setName] = useState("");
  const [Email, setEmail] = useState("");
  const [Phone_no, setPhone_no] = useState("");
  const [Age, setAge] = useState("");
  const [City, setCity] = useState("");
  const [State, setState] = useState("");
  const [pinCode, setpinCode] = useState("");
  const [Password, setPassword] = useState("");

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await fetch("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          Name,
          Email,
          Phone_no,
          Age,
          City,
          State,
          pinCode,
          Password
        }),
      });

      const data = await response.json();

      if (response.ok) {
        router.push("/dashboard");
      } else {
        alert(data.error || "Signup failed");
      }
    }catch(err:any){
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
          value={Name}
          onChange={(e) => setName(e.target.value)}
          required
        />

        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="Age"
            className="inputBox"
            value={Age}
            onChange={(e) => setAge(e.target.value)}
            required
          />

          <input
            type="text"
            placeholder="City"
            className="inputBox"
            value={City}
            onChange={(e) => setCity(e.target.value)}
            required
          />
        </div>

        <input
          type="email"
          placeholder="Email"
          className="inputBox"
          value={Email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          type="text"
          placeholder="Mobile Number"
          className="inputBox"
          value={Phone_no}
          onChange={(e) => setPhone_no(e.target.value)}
          required
        />

        <div className="grid grid-cols-2 gap-4">
          <input
            type="text"
            placeholder="State"
            className="inputBox"
            value={State}
            onChange={(e) => setState(e.target.value)}
            required
          />

          <input
            type="text"
            placeholder="Pincode"
            className="inputBox"
            value={pinCode}
            onChange={(e) => setpinCode(e.target.value)}
            required
          />
        </div>

        <input
          type="password"
          placeholder="Password"
          className="inputBox"
          value={Password}
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
