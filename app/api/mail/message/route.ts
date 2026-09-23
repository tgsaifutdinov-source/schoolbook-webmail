import {getMailSession} from "../../../../lib/mail-session";import {NextRequest,NextResponse} from "next/server";
export async function GET(req:NextRequest){
 const token=(await getMailSession())?.token;if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const id=req.nextUrl.searchParams.get("id");if(!id)return NextResponse.json({error:"Missing id"},{status:400});
 const h={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers:h,cache:"no-store"});if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const s=await sr.json();const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];const u=new URL(s.apiUrl);
 const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/get",{accountId,ids:[id],properties:["id","from","to","cc","bcc","replyTo","subject","receivedAt","preview","textBody","htmlBody","bodyValues","attachments","size"],fetchTextBodyValues:true,fetchHTMLBodyValues:true,maxBodyValueBytes:2000000},"e"]]};
 const r=await fetch("http://host.docker.internal:18080"+u.pathname+u.search,{method:"POST",headers:h,body:JSON.stringify(body),cache:"no-store"});const d=await r.json();const hit=(d.methodResponses||[]).find((x:any)=>x[0]==="Email/get");return NextResponse.json(hit?.[1]?.list?.[0]||null);
}