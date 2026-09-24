import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";

export async function GET(req:NextRequest){
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const id=req.nextUrl.searchParams.get("id");
 if(!id)return NextResponse.json({error:"Missing id"},{status:400});
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
 if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const session=await sr.json();
 const accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
 if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
 const u=new URL(session.apiUrl);
 const endpoint="http://host.docker.internal:18080"+u.pathname+u.search;
 const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/get",{accountId,ids:[id],properties:["id","threadId","mailboxIds","keywords","messageId","inReplyTo","references","from","to","cc","bcc","replyTo","subject","receivedAt","preview","textBody","htmlBody","bodyValues","attachments","hasAttachment","size"],fetchTextBodyValues:true,fetchHTMLBodyValues:true,maxBodyValueBytes:2000000},"e"]]};
 const r=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body),cache:"no-store"});
 if(!r.ok)return NextResponse.json({error:"JMAP request failed"},{status:r.status});
 const d=await r.json();
 const hit=(d.methodResponses||[]).find((x:any)=>x[0]==="Email/get")?.[1]?.list?.[0];
 if(!hit)return NextResponse.json({error:"Message not found"},{status:404});
 let thread:any[]=[];
 let threadTotal=1;
 if(hit.threadId){
  try{
   const tr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Thread/get",{accountId,ids:[hit.threadId]},"t"]]}),cache:"no-store"});
   const td=await tr.json();
   const emailIds=(td.methodResponses||[]).find((x:any)=>x[0]==="Thread/get")?.[1]?.list?.[0]?.emailIds||[];
   threadTotal=emailIds.length||1;
   if(emailIds.length>1){
    const ids=emailIds.slice(-50);
    const er=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/get",{accountId,ids,properties:["id","threadId","mailboxIds","keywords","from","to","cc","subject","receivedAt","preview","hasAttachment","size"]},"e"]]}),cache:"no-store"});
    const ed=await er.json();
    thread=((ed.methodResponses||[]).find((x:any)=>x[0]==="Email/get")?.[1]?.list||[]).sort((a:any,b:any)=>String(a.receivedAt||"").localeCompare(String(b.receivedAt||"")));
   }
  }catch{}
 }
 return NextResponse.json({...hit,thread,threadTotal});
}
