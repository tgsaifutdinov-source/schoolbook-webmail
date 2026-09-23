import {cookies} from "next/headers";
import {randomBytes} from "crypto";

type Session={token:string;username:string;expiresAt:number};
declare global{var __schoolbookMailSessions:Map<string,Session>|undefined}
const store=globalThis.__schoolbookMailSessions||(globalThis.__schoolbookMailSessions=new Map<string,Session>());
const TTL=12*60*60*1000;
const MAX_SESSIONS=5000;

function cleanup(){
 const now=Date.now();
 for(const [id,session] of store)if(session.expiresAt<=now)store.delete(id);
 while(store.size>=MAX_SESSIONS){
  let oldestId:string|undefined;
  let oldestExpiry=Infinity;
  for(const [id,session] of store){
   if(session.expiresAt<oldestExpiry){oldestId=id;oldestExpiry=session.expiresAt}
  }
  if(!oldestId)break;
  store.delete(oldestId);
 }
}
export function createMailSession(token:string,username:string){
 cleanup();
 const id=randomBytes(32).toString("base64url");
 store.set(id,{token,username,expiresAt:Date.now()+TTL});
 return id;
}
export async function getMailSession(){
 cleanup();
 const id=(await cookies()).get("sbmail_session")?.value;
 if(!id)return null;
 const session=store.get(id);
 if(!session)return null;
 session.expiresAt=Date.now()+TTL;
 return {id,...session};
}
export function destroyMailSession(id?:string){if(id)store.delete(id)}
export const mailSessionCookie={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/",maxAge:TTL/1000};
