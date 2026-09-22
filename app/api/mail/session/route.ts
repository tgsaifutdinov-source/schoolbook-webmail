import {cookies} from "next/headers";
import {NextResponse} from "next/server";
export async function GET(){
 const token=(await cookies()).get("sbmail_auth")?.value;
 if(!token)return NextResponse.json({authenticated:false},{status:401});
 try{const r=await fetch("http://host.docker.internal:18080/jmap/session",{headers:{Authorization:"Basic "+token},cache:"no-store"});
 if(!r.ok)return NextResponse.json({authenticated:false},{status:401});
 return NextResponse.json({authenticated:true,session:await r.json()});
 }catch{return NextResponse.json({error:"Stalwart unavailable"},{status:502})}
}