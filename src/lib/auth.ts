import {jwtVerify,SignJWT,JWTPayload} from "jose";
const JWT_SECRET=process.env.JWT_SECRET;


if(!JWT_SECRET){
    throw new Error("missing jwt_secret");
}

const secret_key=new TextEncoder().encode(JWT_SECRET);


export async function createToken(payload: Record<string,any>){
  // console.log("Creating token with payload:", payload);
    return await new SignJWT(payload)
    .setProtectedHeader({alg: "HS256"})
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(secret_key);
    
}

export async function verifyToken(token: string){
    try{
        const {payload}= await jwtVerify(token, secret_key);
        console.log("Verified token payload:", payload);
        return {valid: true, payload:payload as JWTPayload};
    }catch(err:any){
        return {valid: false, error: err?.message ?? String(err) };
    }
};

export async function getUserId(token: string) {
  const result = await verifyToken(token);

  if (!result.valid) {
    return { valid: false, 
            userId: null, 
            error: result.error 
          };
  }
    
  const userId = (result.payload as any).id;

  return {
    valid: true,
    userId,
  };
}