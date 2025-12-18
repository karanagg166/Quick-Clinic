"use client";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  const handleSignup = () => {
    router.push("/auth/signup");
  };

  const handleLogin = () => {
    router.push("/auth/login");
  };

  

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-100 px-4">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-md text-center">

        {/* Title */}
        <h1 className="text-3xl font-bold text-gray-800 mb-3">
          Welcome to QuickClinic
        </h1>
        <p className="text-gray-600 mb-8">
          Login or Signup to continue
        </p>

        {/* Buttons */}
        <div className="flex flex-col gap-4">

          <button
            onClick={handleLogin}
            className="w-full bg-blue-600 text-white py-3 rounded-md font-semibold hover:bg-blue-700 transition"
          >
            Login
          </button>

          <button
            onClick={handleSignup}
            className="w-full bg-gray-800 text-white py-3 rounded-md font-semibold hover:bg-black transition"
          >
            Signup
          </button>

        </div>
      </div>
    </div>
  );
}
