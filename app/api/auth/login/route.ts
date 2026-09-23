import {NextRequest,NextResponse} from "next/server";
import {createMailSession,mailSessionCookie} from "../../../../lib/mail-session";
import {clearAccountLoginFailures,loginRateLimit,recordLoginFailure,sameOriginGuard} from "../../../../lib/security";

export async function POST(req:NextRequest){
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const body=await req.json().catch(()=>({}));
 const email=String(body.email||"").trim();
 const password=String(body.password||"");
 if(!email||!password||email.length>254||password.length>1024)return NextResponse.json({error:"Введите email и пароль"},{status:400});
 const retry=loginRateLimit(req,email);
 if(retry)return NextResponse.json({error:"Слишком много попыток входа. Попробуйте позже."},{status:429,headers:{"Retry-After":String(retry)}});
 const token=Buffer.from(email+":"+password).toString("base64");
 try{
  const r=await fetch("http://host.docker.internal:18080/jmap/session",{headers:{Authorization:"Basic "+token},cache:"no-store"});
  if(!r.ok){recordLoginFailure(req,email);return NextResponse.json({error:"Неверный email или пароль"},{status:401})}
  const session=await r.json();
  clearAccountLoginFailures(email);
  const id=createMailSession(token,email);
  const res=NextResponse.json({ok:true,username:email,session});
  res.cookies.set("sbmail_session",id,mailSessionCookie);
  res.cookies.set("sbmail_auth","",{...mailSessionCookie,maxAge:0});
  return res;
 }catch{
  return NextResponse.json({error:"Не удалось подключиться к почтовому серверу"},{status:502});
 }
}
