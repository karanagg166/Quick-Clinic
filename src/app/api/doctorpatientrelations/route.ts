import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";


export async function POST(req: NextRequest) {  
    try{
        const body =  await req.json();
        const {doctorId, patientId} = body;

        if (!doctorId || !patientId) {
            return NextResponse.json({ error: "doctorId and patientId are required" }, { status: 400 });
        }

        // Verify doctor exists
        const doctor = await prisma.doctor.findUnique({
            where: { id: doctorId },
        });

        if (!doctor) {
            return NextResponse.json({ error: "Doctor not found" }, { status: 404 });
        }

        // Verify patient exists
        const patient = await prisma.patient.findUnique({
            where: { id: patientId },
        });

        if (!patient) {
            return NextResponse.json({ error: "Patient not found" }, { status: 404 });
        }

        // Check if relation already exists
        let existingRelation = await prisma.doctorPatientRelation.findUnique({
            where:{
                doctorId_patientId: {
                    doctorId,
                    patientId
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
                doctorId,
                patientId
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