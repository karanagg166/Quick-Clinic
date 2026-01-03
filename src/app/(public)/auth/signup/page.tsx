"use client";

import { motion } from "framer-motion";
import ParticlesBackground from "@/components/general/Particles";
import { SignupForm } from "@/components/auth/SignupForm";

export default function Signup() {
  return (
    <div className="relative min-h-screen flex items-center justify-center bg-background px-4 py-10 overflow-hidden">
      <ParticlesBackground />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="relative z-10 w-full max-w-2xl"
      >
        <SignupForm />
      </motion.div>
    </div>
  );
}
