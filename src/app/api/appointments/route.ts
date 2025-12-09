import {prisma} from '@/lib/prisma';
import {NextRequest, NextResponse} from 'next/server';
export async function POST(req: NextRequest) {
    try {  
     const {doctorId,patientId,slotId}=await req.json();
       
     // Create appointment
     const appointment = await prisma.appointment.create({
         data: {
             doctorId,
             patientId,
             slotId,
             status: 'PENDING',
         },
     });

    const slotUpdate = await prisma.slot.update({
        where: { id: slotId },
        data: { status: 'BOOKED' },
     });
    return NextResponse.json({appointment,slotUpdate},{status:201});

}
    catch (err: any) {
        return NextResponse.json({message:"internal server error"},{status:500});
    }
 }
