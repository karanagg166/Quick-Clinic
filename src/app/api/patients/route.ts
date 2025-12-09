import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const POST = async (req: NextRequest) => {
	try {
		const body = await req.json();
		const {
			userId,
			medicalHistory = "",
			allergies = "",
			currentMedications = "",
		} = body ?? {};

		if (!userId || typeof userId !== "string") {
			return NextResponse.json({ error: "userId is required" }, { status: 400 });
		}

		const user = await prisma.user.findUnique({ where: { id: userId } });
		if (!user) {
			return NextResponse.json({ error: "User not found" }, { status: 404 });
		}

		const existing = await prisma.patient.findUnique({ where: { userId } });
		if (existing) {
			return NextResponse.json(
				{ error: "Patient profile already exists for this user" },
				{ status: 409 }
			);
		}

		const patient = await prisma.patient.create({
			data: {
				userId,
				medicalHistory,
				allergies,
				currentMedications,
			},
		});

		return NextResponse.json({ patient }, { status: 201 });
	} catch (err: any) {
		console.error("patients-post-error", err);
		return NextResponse.json(
			{ error: err?.message ?? "Server error" },
			{ status: 500 }
		);
	}
};

export const GET = async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url);

    const doctorId = searchParams.get("doctorId");

    if (!doctorId) {
      return NextResponse.json(
        { error: "doctorId is required" },
        { status: 400 }
      );
    }

    // --- Build filters ---
    // Patient-level filters (medicalHistory, allergies, currentMedications)
    const patientFilter: any = {};

    if (searchParams.get("medicalHistory")) {
      patientFilter.medicalHistory = {
        contains: searchParams.get("medicalHistory") || "",
        mode: "insensitive",
      };
    }

    if (searchParams.get("allergy")) {
      // your schema field is `allergies`
      patientFilter.allergies = {
        contains: searchParams.get("allergy") || "",
        mode: "insensitive",
      };
    }

    if (searchParams.get("currentMedications")) {
      patientFilter.currentMedications = {
        contains: searchParams.get("currentMedications") || "",
        mode: "insensitive",
      };
    }

    // User-related filters (nested relation)
    const userFilter: any = {};
    if (searchParams.get("name")) {
      userFilter.name = {
        contains: searchParams.get("name") || "",
        mode: "insensitive",
      };
    }
    if (searchParams.get("age")) {
      const age = Number(searchParams.get("age"));
      if (!Number.isNaN(age)) userFilter.age = age;
    }
    if (searchParams.get("gender")) {
      userFilter.gender = searchParams.get("gender");
    }
    if (searchParams.get("city")) {
      userFilter.city = {
        contains: searchParams.get("city") || "",
        mode: "insensitive",
      };
    }
    if (searchParams.get("state")) {
      userFilter.state = {
        contains: searchParams.get("state") || "",
        mode: "insensitive",
      };
    }

    // --- Get patient IDs who have appointments with the doctor ---
    const appointmentRows = await prisma.appointment.findMany({
      where: { doctorId },
      select: { patientId: true },
    });

    const patientIds = appointmentRows.map((r) => r.patientId);

    if (patientIds.length === 0) {
      // no patients for this doctor
      return NextResponse.json([], { status: 200 });
    }

    // --- Compose final where for patient.findMany ---
    const where: any = {
      id: { in: patientIds },
      ...patientFilter,
    };

    if (Object.keys(userFilter).length > 0) {
      // `user` is a single relation on Patient - use `is` to filter
      where.user = { is: userFilter };
    }

    // --- Query patients with selected fields only ---
    const patients = await prisma.patient.findMany({
      where,
      select: {
        id: true,
        medicalHistory: true,
        allergies: true,
        currentMedications: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            city: true,
            state: true,
            age: true,
            gender: true,
            phoneNo: true,
          },
        },
      },
    });

    return NextResponse.json(patients, { status: 200 });
  } catch (err: any) {
    console.error("patients-get-error", err);
    return NextResponse.json(
      { error: err?.message ?? "Server error" },
      { status: 500 }
    );
  }
};

export const PATCH = async(req: NextRequest) {
	try{
     const {patientId, medicalHistory, allergies, currentMedications}=await req.json();
	 if(!patientId){
	  return NextResponse.json({ error: "patientId is required" }, { status: 400 });
	 }
	 const existingPatient=await prisma.patient.findUnique({where:{id:patientId}});
	 if(!existingPatient){
	  return NextResponse.json({ error: "Patient not found" }, { status: 404 });
	 }
	 const updatedPatient=await prisma.patient.update({
	  where:{id:patientId},
	  data:{
	   medicalHistory:medicalHistory??existingPatient.medicalHistory,
	   allergies:allergies??existingPatient.allergies,
	   currentMedications:currentMedications??existingPatient.currentMedications,
	  }
	 });
	 return NextResponse.json({patient:updatedPatient},{status:200}); 
	}
	catch(err:any){	

	}
}
