"use client";

import { useEffect } from "react";

export default function Watermark() {
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || true) {
      console.log(
        "%c QuickClinic %c Made by Karan Aggarwal & Harsh Mishra ",
        "background: #3b82f6; color: #fff; padding: 4px; border-radius: 4px 0 0 4px; font-weight: bold;",
        "background: #1e293b; color: #fff; padding: 4px; border-radius: 0 4px 4px 0;",
      );
      console.log(
        "%c Stop! %c This project is protected by copyright. Unauthorized copying is prohibited.",
        "color: red; font-size: 20px; font-weight: bold;",
        "color: #64748b; font-size: 14px;"
      );
    }
  }, []);

  return null;
}
