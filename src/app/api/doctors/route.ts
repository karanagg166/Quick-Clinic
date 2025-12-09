import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { Doctor } from "@/types/doctor";



export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;

    // Build root (doctor) and related (user) filters
    const filtersDoctor: any = {};
    const filtersUser: any = {};

    if (searchParams.has("city")) {
      filtersUser.city = searchParams.get("city");
    }
    if (searchParams.has("state")) {
      filtersUser.state = searchParams.get("state");
    }
    if (searchParams.has("specialty")) {
      filtersDoctor.specialty = searchParams.get("specialty");
    }
    if (searchParams.has("name")) {
      filtersUser.name = {
        contains: searchParams.get("name"),
        mode: "insensitive",
      };
    }
    if (searchParams.has("gender")) {
      filtersUser.gender = searchParams.get("gender");
    }
    if (searchParams.has("fees")) {
      const fees = Number(searchParams.get("fees"));
      if (!Number.isNaN(fees)) filtersDoctor.fees = fees;
    }
    if (searchParams.has("experience")) {
      const exp = Number(searchParams.get("experience"));
      if (!Number.isNaN(exp)) filtersDoctor.experience = exp;
    }

    // Compose final where.
    const where: any = { ...filtersDoctor };
    if (Object.keys(filtersUser).length > 0) {
      where.user = { is: filtersUser };
    }

    const raw = await prisma.doctor.findMany({
      where,
      select: {
        id: true,
        specialty: true,
        qualifications: true,
        fees: true,
        experience: true,
        user: {
          select: {
            name: true,
            gender: true,
            age: true,
            city: true,
            state: true,
          },
        },
      },
    });
console.log("doctors-raw", raw);
    // Map raw Prisma result -> your Doctor type
    const doctors: Doctor[] = raw.map((d:any) => {
      return {
        id: String(d.id),
       
        name: d.user?.name ?? "",
        gender: d.user?.gender ?? "",
        age: d.user?.age ?? 0,
        specialty: d.specialty ?? "",
        experience: d.experience ?? 0,
        fees: d.fees ?? 0,
       
        qualifications: Array.isArray(d.qualifications) ? d.qualifications : (d.qualifications ? [d.qualifications] : []),
       
        city: d.user?.city ?? undefined,
        state: d.user?.state ?? undefined,
      };
    });

    return NextResponse.json(doctors, { status: 200 });
  } catch (err: any) {
    console.error("doctors-get-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500}
    );
  }
}

export const POST = async (
  req: NextRequest,
 
) => {
  try {
    const { userId,specialty, experience, qualifications, fees } = await req.json();
   if(!userId){
    return NextResponse.json({ error: "User Not Logined or userId not valid" }, { status: 400 });
   }
    // console.log("create-doctor-payload", { userId,specialty, experience, qualifications, fees });


   
    if (!specialty|| !experience || !qualifications || !fees ) {
      return NextResponse.json({ error: "specialty is required" }, { status: 400 });
    }

    
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
console.log("user-found", user);
    const existing = await prisma.doctor.findUnique({ where: { userId: userId } });
    if (existing) {
      return NextResponse.json({ error: "Doctor profile already exists for this user" }, { status: 409 });
    }

    const created = await prisma.doctor.create({
      data: {
        userId,
        specialty,
        experience,
        qualifications,
        fees,
      },
    });

    return NextResponse.json({ doctor: created }, { status: 201 });
  } catch (err: any) {
    console.error("create-doctor-error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
};
export const PATCH=async(req:NextRequest)=>{
  try {
     const { doctorId,specialty, experience, qualifications, fees } = await req.json();
    if(!doctorId){
     return NextResponse.json({ error: "Doctor not exist yet" }, { status: 400 });
    }
      const existing = await prisma.doctor.findUnique({ where: { id: doctorId } }); 
      if (!existing) {
        return NextResponse.json({ error: "Doctor profile not found" }, { status: 404 });
      }
  
      const updated = await prisma.doctor.update({
        where: { id: doctorId },
        data: {
          specialty: specialty ?? existing.specialty,
          experience: experience ?? existing.experience,
          qualifications: qualifications ?? existing.qualifications,
          fees: fees ?? existing.fees,
        },
      });
  
      return NextResponse.json({ doctor: updated }, { status: 200 });
  }
  catch(err:any){
    console.error("update-doctor-error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}


