import { NextRequest, NextResponse } from "next/server";
import { resend } from "@/lib/resend";
import { prisma } from "@/lib/prisma";

export const POST = async (
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) => {
  try {
    const { userId } = await params;

    // Always derive email from the user record to avoid conflicts
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });

    if (!user?.email) {
      return NextResponse.json(
        { message: "User email not found" },
        { status: 404 }
      );
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Store OTP (upsert by email to handle any stale userId mappings)
    const otpRecord = await prisma.otp.upsert({
      where: {
        email: user.email,
      },
      update: {
        code: otp,
        userId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      create: {
        email: user.email,
        userId,
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    // Send email via Resend (dev-friendly fallback if blocked)
    try {
      const emailSent = await resend.emails.send({
        from: process.env.RESEND_FROM!,
        to: user.email,
        subject: "Your OTP Code",
        html: `
          <h2>OTP Verification</h2>
          <p>Your OTP code is:</p>
          <h1>${otpRecord.code}</h1>
          <p>This OTP is valid for 10 minutes.</p>
        `,
      });
      console.log("Email sent:", emailSent);
      console.log("OTP Code:", otpRecord.code);

      return NextResponse.json(
        { message: "OTP sent successfully" },
        { status: 200 }
      );
    } catch (e) {
      console.error("Resend email send failed:", e);

      // In development, return the OTP so local testing isn't blocked
      if (process.env.NODE_ENV !== "production") {
        return NextResponse.json(
          {
            message:
              "OTP generated (dev mode). Email blocked by Resend test policy.",
            otp: otpRecord.code,
          },
          { status: 200 }
        );
      }

      // In production, instruct to verify a domain
      return NextResponse.json(
        {
          message:
            "Email send failed. Verify a domain at resend.com/domains and set RESEND_FROM to that domain.",
        },
        { status: 500 }
      );
    }
  } catch (err) {
    console.error("OTP send error:", err);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
};