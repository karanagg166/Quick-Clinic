import { NextRequest,NextResponse } from "next/server";
import {prisma } from "@/lib/prisma";
import {hash} from "bcryptjs";
import { createToken } from "@/lib/auth";
export const POST=async (req: NextRequest)=>{
try {
    const {name,email,phoneNo,age,city,state,pinCode,password}=await req.json();
    const existingUser=await prisma.user.findUnique({
        where:{email}
    });
    if(existingUser){
        return NextResponse.json({error:"User already exists"},{status:400});
    }
    const hashedPassword=await hash(password,10);
    await prisma.user.create({
        data:{
            name,
            email,
            phoneNo,
            password:hashedPassword,
            age:parseInt(age,10),
            city,
            state,
            pinCode
        }
    });
    const res=NextResponse.json({message:"user Signuped successfully"},{status:200});
    const token=await createToken({email});
    res.cookies.set("token",token,{
        httpOnly:true,
        secure:true,
        path: "/",
        sameSite: "strict",

        maxAge: 60 * 60 * 24,
    });


    

return res;
}
catch(error:any){
    return NextResponse.json({error: error?.message ?? String(error)}, {status: 500});
}


}