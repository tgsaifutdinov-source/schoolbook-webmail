import {NextRequest,NextResponse} from "next/server";
import {createMailSession,mailSessionCookie} from "../../../../lib/mail-session";
export async function POST(req:NextRequest){
 const body=await req.json().catch(()=>({}));const email=String(body.email||"").trim(),password=String(body.password||"");
 if(!email||!password)return NextResponse.json({error:"Введите email и пароль"},{status:400});
 const token=Buffer.from(email+":"+password).toString("base64");
 try{
  const r=await fetch("http://host.docker.internal:18080/jmap/session",{headers:{Authorization:"Basic "+token},cache:"no-store"});
  if(!r.ok)return NextResponse.json({error:"Неверный email или пароль"},{status:401});
  const session=await r.json();const id=createMailSession(token,email);
  const res=NextResponse.json({ok:true,username:email,session});
  res.cookies.set("sbmail_session",id,mailSessionCookie);res.cookies.set("sbmail_auth","",{...mailSessionCookie,maxAge:0});
  return res;
 }catch{return NextResponse.json({error:"Не удалось подключиться к почтовому серверу"},{status:502})}
}