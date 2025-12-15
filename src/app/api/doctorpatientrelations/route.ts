import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


// GET → list relations for a user (patient or doctor) with last message
export async function GET(req: NextRequest) {
    try {
        const { searchParams } = new URL(req.url);
        const userId = searchParams.get("userId");
        const role = searchParams.get("role");

        if (!userId || !role) {
            return NextResponse.json(
                { error: "userId and role are required" },
                { status: 400 }
            );
        }

        const isPatient = role === "PATIENT";
        const isDoctor = role === "DOCTOR";

        if (!isPatient && !isDoctor) {
            return NextResponse.json(
                { error: "role must be PATIENT or DOCTOR" },
                { status: 400 }
            );
        }

        const relations = await prisma.doctorPatientRelation.findMany({
            where: isPatient
                ? { patientsUserId: userId }
                : { doctorsUserId: userId },
            include: {
                doctor: {
                    include: {
                        user: true,
                    },
                },
                patient: {
                    include: {
                        user: true,
                    },
                },
                chatMessages: {
                    orderBy: { createdAt: "desc" },
                    take: 1,
                },
            },
            orderBy: { updatedAt: "desc" },
        });

        const mapped = relations.map((r: (typeof relations)[number]) => {
            const last = r.chatMessages?.[0];

            return {
                id: r.id,
                doctorName: r.doctor?.user?.name ?? "Doctor",
                patientName: r.patient?.user?.name ?? "Patient",
                lastMessage: last?.text ?? null,
                lastMessageAt: last?.createdAt ?? r.updatedAt,
            };
        });

        return NextResponse.json({ relations: mapped }, { status: 200 });
    } catch (error) {
        console.error("Error listing relations:", error);
        return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
    }
}


export async function POST(req: NextRequest) {  
    try{
        const body =  await req.json();
        const {doctorsUserId, patientsUserId} = body;

        if (!doctorsUserId || !patientsUserId) {
            return NextResponse.json({ error: "doctorsUserId and patientsUserId are required" }, { status: 400 });
        }

        // Verify doctor exists with the given userId
        const doctor = await prisma.doctor.findUnique({
            where: { userId: doctorsUserId },
        });

        if (!doctor) {
            return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
        }

        // Verify patient exists with the given userId
        const patient = await prisma.patient.findUnique({
            where: { userId: patientsUserId },
        });

        if (!patient) {
            return NextResponse.json({ error: "Patient not found" }, { status: 404 });
        }

        // Check if relation already exists
        let existingRelation = await prisma.doctorPatientRelation.findUnique({
            where:{
                doctorsUserId_patientsUserId: {
                    doctorsUserId,
                    patientsUserId
                }
            }
        });

        // If exists, return it
        if (existingRelation) {
            return NextResponse.json({ 
                relation: existingRelation,
                isNew: false 
            }, { status: 200 });
        }

        // If doesn't exist, create it
        const newRelation = await prisma.doctorPatientRelation.create({
            data: {
                doctorsUserId,
                patientsUserId
            }
        });

        return NextResponse.json({ 
            relation: newRelation,
            isNew: true 
        }, { status: 201 });
    }
    catch(error){
        console.error("Error creating/fetching relation:", error);
        return NextResponse.json({error:"Internal Server Error"}, {status:500})
    }
}
