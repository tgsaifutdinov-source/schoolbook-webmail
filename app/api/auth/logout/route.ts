import {NextRequest,NextResponse} from "next/server";
import {getMailSession,destroyMailSession,mailSessionCookie} from "../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../lib/security";

export async function POST(req:NextRequest){
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const session=await getMailSession();
 destroyMailSession(session?.id);
 const response=NextResponse.json({ok:true});
 response.cookies.set("sbmail_session","",{...mailSessionCookie,maxAge:0});
 response.cookies.set("sbmail_auth","",{...mailSessionCookie,maxAge:0});
 return response;
}
