import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";



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
    const {
      name,
      email,
      phoneNo,
      age,
      city,
      state,
      pinCode, 
      password,
      address,
      role,
      gender
    } = await req.json();

    const normalizedRole = role.toUpperCase();

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      return NextResponse.json(
        { error: "User already exists" },
        { status: 400 }
      );
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        name,
        email,
        phoneNo,
        password: hashedPassword,
        age: Number(age),
        city,
        address,
        state,
        pinCode: Number(pinCode),
        role: normalizedRole, 
        gender:gender
      },
      
    });
const userDetails: User = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      gender: user.gender,
      age: user.age,
    };
    const res = NextResponse.json(
      
      { message: "User created successfully",userDetails },
      { status: 201 }
    );

    return res;

  } catch (error: any) {
    console.error("Signup Error:", error);

    return NextResponse.json(
      { error: error?.message ?? "Server error" },
      { status: 500 }
    );
  }
};
