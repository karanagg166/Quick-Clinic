import { NextRequest,NextResponse} from "next/server";
import { resend } from "@/lib/resend";
import {prisma} from "@/lib/prisma";
export const POST= async (request:NextRequest,{ params }: { params: Promise<{ userId: string }> })=>{
try {
    const { userId } = await params;
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { message: "Email is required" },
        { status: 400 }
      );
    }

    // Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Send email via Resend
   const emailSent = await resend.emails.send({
      from: process.env.RESEND_FROM!,
      to: email,
      subject: "Your OTP Code",
      html: `
        <h2>OTP Verification</h2>
        <p>Your OTP code is:</p>
        <h1>${otp}</h1>
        <p>This OTP is valid for 10 minutes.</p>
      `,
    });
    console.log("Email sent:", emailSent);

    // Store OTP (upsert)
    await prisma.otp.upsert({
      where: {
        userId,
      },
      update: {
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
      create: {
        email,
        userId,
        code: otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    return NextResponse.json(
      { message: "OTP sent successfully" },
      { status: 200 }
    );
  } catch (err) {
    console.error("OTP send error:", err);
    return NextResponse.json(
      { message: "Internal Server Error" },
      { status: 500 }
    );
  }
};