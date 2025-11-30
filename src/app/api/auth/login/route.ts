import { NextRequest,NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {prisma} from "@/lib/prisma";

export const POST=async (req:NextRequest)=>{
    try{
        const {email,password}=await req.json();
        const user=await prisma.user.findUniue({
            where:{email}
        });
        if(!user){
             return NextResponse.json({error:"Innvald Email No user"},{status:400});  
        }
        const isPasswordValid=await bcrypt.compare(password,user.password);
        if(!isPasswordValid){
            return NextResponse.json({error:"Invalid Password"},{status:400});
        }
        const res=NextResponse.json({message:"Login successful"},{status:200});
        return res;
       
        

    }
    catch(error:any){
        return NextResponse.json({error:error?.message },{
            status:500
        });
    }
}