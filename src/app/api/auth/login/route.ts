import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createToken } from "@/lib/auth";

export const POST = async (req: NextRequest) => {
  try {
    const { email, password } = await req.json();

    // Check user
    const user = await prisma.user.findUnique({
      where: { email:email
            
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
    const token = await createToken({ id: user.id,email: user.email,
      role: user.role 
    });
    

    // Response
    const res = NextResponse.json(
      { message: "Login successful" ,
        role: user.role

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
