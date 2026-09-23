import {NextRequest,NextResponse} from "next/server";

type Attempt={count:number;windowUntil:number;blockedUntil:number};
declare global{var __schoolbookLoginAttempts:Map<string,Attempt>|undefined}
const attempts=globalThis.__schoolbookLoginAttempts||(globalThis.__schoolbookLoginAttempts=new Map<string,Attempt>());
const WINDOW=10*60*1000;
const BLOCK=15*60*1000;
const MAX_ENTRIES=5000;

function trimAttempts(){
 const now=Date.now();
 for(const [key,value] of attempts){
  if(value.windowUntil<=now&&value.blockedUntil<=now)attempts.delete(key);
 }
 while(attempts.size>MAX_ENTRIES){
  const first=attempts.keys().next().value as string|undefined;
  if(!first)break;
  attempts.delete(first);
 }
}
function clientIp(req:NextRequest){
 return (req.headers.get("x-forwarded-for")||req.headers.get("x-real-ip")||"unknown").split(",")[0].trim();
}
function keys(req:NextRequest,email:string){
 return [
  {key:"ip:"+clientIp(req),max:12},
  {key:"account:"+email.trim().toLowerCase(),max:6}
 ];
}
export function sameOriginGuard(req:NextRequest){
 const site=req.headers.get("sec-fetch-site");
 if(site&&site!=="same-origin"&&site!=="none"){
  return NextResponse.json({error:"Cross-site request blocked"},{status:403});
 }
 const origin=req.headers.get("origin");
 if(origin){
  try{
   const host=(req.headers.get("x-forwarded-host")||req.headers.get("host")||"").split(",")[0].trim();
   const proto=(req.headers.get("x-forwarded-proto")||req.nextUrl.protocol.replace(":","")||"https").split(",")[0].trim();
   if(host&&new URL(origin).origin!==proto+"://"+host){
    return NextResponse.json({error:"Invalid request origin"},{status:403});
   }
  }catch{
   return NextResponse.json({error:"Invalid request origin"},{status:403});
  }
 }
 return null;
}
export function loginRateLimit(req:NextRequest,email:string){
 trimAttempts();
 const now=Date.now();
 let retry=0;
 for(const item of keys(req,email)){
  const value=attempts.get(item.key);
  if(value?.blockedUntil&&value.blockedUntil>now)retry=Math.max(retry,Math.ceil((value.blockedUntil-now)/1000));
 }
 return retry;
}
export function recordLoginFailure(req:NextRequest,email:string){
 trimAttempts();
 const now=Date.now();
 for(const item of keys(req,email)){
  const old=attempts.get(item.key);
  const value=!old||old.windowUntil<=now?{count:0,windowUntil:now+WINDOW,blockedUntil:0}:{...old};
  value.count++;
  if(value.count>=item.max)value.blockedUntil=now+BLOCK;
  attempts.set(item.key,value);
 }
}
export function clearAccountLoginFailures(email:string){
 attempts.delete("account:"+email.trim().toLowerCase());
}
