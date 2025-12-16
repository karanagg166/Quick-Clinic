"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore"; // Ensure this path matches your store
import type { User } from "@/types/common";
import AvatarUploader from "@/components/general/AvatarUploader";

export default function UpdateProfile() {
  const router = useRouter();
  
  // Get current user and setter from store
  const { user, setUser } = useUserStore();
   const userId= user?.userId;
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
            alert("Please enter a valid 6-digit pincode.");
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

      alert("Profile updated successfully!");

      // 4. Update the local Zustand store with new data
      // We merge existing user object with the updated fields
      if (user) {
          const updatedUser: User = {
              ...user,
              name: formData.name,
              age: Number(formData.age),
              gender: formData.gender as "MALE" | "FEMALE" | "BINARY",
              doctorId: null,
              patientId: null
          };
          setUser(updatedUser);
      }

      // Redirect back to profile dashboard
      const dashboardRoute = formData.role === "PATIENT" ? "/user/profile/patient" : "/user/profile/doctor";
      router.push(dashboardRoute);

    } catch (err: any) {
      console.error("Update Error:", err);
      alert(err.message || "Something went wrong.");
    } finally {
      setUpdating(false);
    }
  };

  if (loadingData) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blue-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-blue-100 px-4 py-10">
      <div className="w-full max-w-md bg-white shadow-xl rounded-2xl p-8 border border-gray-200">
        <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-800">
            Update Profile
            </h2>
            <button 
                onClick={() => router.back()}
                className="text-sm text-gray-500 hover:text-gray-800 hover:underline"
            >
                Cancel
            </button>
        </div>

        {/* Avatar section */}
        <div className="mb-6">
          {/* Pass current userId and initial avatar from store if available */}
          {userId && (
            <AvatarUploader userId={userId} initialUrl={user?.profileImageUrl} />
          )}
        </div>

        <form onSubmit={handleUpdate} className="flex flex-col gap-4">
          
          {/* Read-Only Role Display */}
          <div className="bg-blue-50 p-3 rounded-lg border border-blue-100 flex justify-between items-center">
            <span className="text-sm text-blue-800 font-medium">Account Type:</span>
            <span className="text-sm font-bold text-blue-900 tracking-wide">{formData.role}</span>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Full Name</label>
            <input
                type="text"
                name="name"
                className="inputBox mt-1"
                value={formData.name}
                onChange={handleChange}
                required
            />
          </div>

          <div className="flex gap-4">
            <div className="w-1/3">
                <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Age</label>
                <input
                    type="number"
                    name="age"
                    className="inputBox mt-1"
                    value={formData.age}
                    onChange={handleChange}
                    required
                    min={0}
                />
            </div>
            <div className="w-2/3">
                <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Gender</label>
                <select
                    name="gender"
                    value={formData.gender}
                    onChange={handleChange}
                    className="border border-gray-300 text-gray-700 rounded-xl px-4 py-3 w-full bg-white shadow-sm focus:ring-2 focus:ring-blue-500 outline-none mt-1"
                    required
                >
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="BINARY">Binary</option>
                </select>
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Address</label>
            <input
                type="text"
                name="address"
                className="inputBox mt-1"
                value={formData.address}
                onChange={handleChange}
                required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
                <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">City</label>
                <input
                type="text"
                name="city"
                className="inputBox mt-1"
                value={formData.city}
                onChange={handleChange}
                required
                />
            </div>

            <div>
                <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">State</label>
                <input
                type="text"
                name="state"
                className="inputBox mt-1"
                value={formData.state}
                onChange={handleChange}
                required
                />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Email (Read-only)</label>
            <input
                type="email"
                name="email"
                className="inputBox mt-1 bg-gray-100 text-gray-500 cursor-not-allowed"
                value={formData.email}
                disabled
                title="Email cannot be changed"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Mobile Number</label>
            <input
                type="tel"
                name="phoneNo"
                className="inputBox mt-1"
                value={formData.phoneNo}
                onChange={handleChange}
                required
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 ml-1 uppercase">Pincode</label>
            <input
                type="text"
                name="pinCode"
                className="inputBox mt-1"
                value={formData.pinCode}
                onChange={handleChange}
                required
            />
          </div>

          <button
            type="submit"
            className="mt-4 bg-blue-600 text-white py-3 rounded-xl font-semibold hover:bg-blue-700 transition-all shadow-md hover:shadow-lg disabled:opacity-60 flex justify-center items-center gap-2"
            disabled={updating}
          >
            {updating ? (
                <>
                 <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></span>
                 Updating...
                </>
            ) : (
                "Save Changes"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}