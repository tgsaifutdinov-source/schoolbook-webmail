import {NextRequest,NextResponse} from "next/server";
export async function POST(req:NextRequest){
 const {email,password}=await req.json();
 if(!email||!password)return NextResponse.json({error:"Введите email и пароль"},{status:400});
 const token=Buffer.from(email+":"+password).toString("base64");
 try{
  const r=await fetch("http://host.docker.internal:18080/jmap/session",{headers:{Authorization:"Basic "+token},cache:"no-store"});
  if(!r.ok)return NextResponse.json({error:"Неверный email или пароль"},{status:401});
  const session=await r.json();
  const res=NextResponse.json({ok:true,username:email,session});
  res.cookies.set("sbmail_auth",token,{httpOnly:true,secure:true,sameSite:"lax",path:"/",maxAge:60*60*12});
  return res;
 }catch{return NextResponse.json({error:"Не удалось подключиться к почтовому серверу"},{status:502})}
}