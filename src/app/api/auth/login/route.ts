import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";
import { use } from "react";


interface User {
  id: string;
  email: string;
  role: string;
  name: string;
  gender: string;
  age: number;
}



export const POST = async (req: NextRequest) => {
  try {
    const { email, password } = await req.json();

    // Check user
    const user = await prisma.user.findUnique({
      where: {
         email:email    
       },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email. No user found." },
        { status: 400 }
      );
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: "Incorrect password" },
        { status: 400 }
      );
    }

    // JWT token
    const token = await createToken({ 
      id: user.id,
      email: user.email,
      role: user.role 
    });

    const userDetails: User = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      gender: user.gender,
      age: user.age,
    };
    

    

    // Response
    const res = NextResponse.json(
      {
        message: "Login successful",
        user: userDetails,
      },
      { status: 200 }
    );

   
    res.cookies.set("Authtoken", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return res;
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
