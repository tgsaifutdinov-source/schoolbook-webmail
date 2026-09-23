import {cookies} from "next/headers";
import {randomBytes} from "crypto";

type Session={token:string,username:string,expiresAt:number};
declare global{var __schoolbookMailSessions:Map<string,Session>|undefined}
const store=globalThis.__schoolbookMailSessions||(globalThis.__schoolbookMailSessions=new Map<string,Session>());
const TTL=12*60*60*1000;
function cleanup(){const now=Date.now();for(const [id,s] of store)if(s.expiresAt<=now)store.delete(id)}
export function createMailSession(token:string,username:string){cleanup();const id=randomBytes(32).toString("base64url");store.set(id,{token,username,expiresAt:Date.now()+TTL});return id}
export async function getMailSession(){cleanup();const id=(await cookies()).get("sbmail_session")?.value;if(!id)return null;const s=store.get(id);if(!s)return null;s.expiresAt=Date.now()+TTL;return {id,...s}}
export function destroyMailSession(id?:string){if(id)store.delete(id)}
export const mailSessionCookie={httpOnly:true,secure:true,sameSite:"lax" as const,path:"/",maxAge:TTL/1000};
