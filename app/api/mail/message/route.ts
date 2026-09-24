import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";

const THREAD_LIMIT=50;
const THREAD_BODY_LIMIT=400_000;
const MESSAGE_PROPERTIES=[
 "id","threadId","mailboxIds","keywords","messageId","inReplyTo","references",
 "from","to","cc","bcc","replyTo","subject","receivedAt","preview",
 "textBody","htmlBody","bodyValues","attachments","hasAttachment","size"
];

export async function GET(req:NextRequest){
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const id=req.nextUrl.searchParams.get("id");
 const prefetch=req.nextUrl.searchParams.get("prefetch")==="1";
 if(!id)return NextResponse.json({error:"Missing id"},{status:400});
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
 if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const session=await sr.json();
 const accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
 if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
 const u=new URL(session.apiUrl);
 const endpoint="http://host.docker.internal:18080"+u.pathname+u.search;
 const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/get",{accountId,ids:[id],properties:MESSAGE_PROPERTIES,fetchTextBodyValues:true,fetchHTMLBodyValues:true,maxBodyValueBytes:prefetch?600_000:2_000_000},"e"]]};
 const r=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body),cache:"no-store"});
 if(!r.ok)return NextResponse.json({error:"JMAP request failed"},{status:r.status});
 const d=await r.json();
 const hit=(d.methodResponses||[]).find((x:any)=>x[0]==="Email/get")?.[1]?.list?.[0];
 if(!hit)return NextResponse.json({error:"Message not found"},{status:404});

 let thread:any[]=[];
 let threadTotal=1;
 let threadTruncated=false;
 if(hit.threadId){
  try{
   const tr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({
    using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],
    methodCalls:[["Thread/get",{accountId,ids:[hit.threadId]},"t"]]
   }),cache:"no-store"});
   const td=await tr.json();
   const emailIds:string[]=(td.methodResponses||[]).find((x:any)=>x[0]==="Thread/get")?.[1]?.list?.[0]?.emailIds||[];
   threadTotal=emailIds.length||1;
   if(emailIds.length>1&&!prefetch){
    const newest=emailIds.slice(-THREAD_LIMIT);
    const limited=newest.includes(hit.id)?newest:[...emailIds.slice(-(THREAD_LIMIT-1)),hit.id];
    const ids=[...new Set(limited)].filter(emailId=>emailId!==hit.id);
    let list:any[]=[];
    if(ids.length){
     const er=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({
      using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],
      methodCalls:[["Email/get",{accountId,ids,properties:MESSAGE_PROPERTIES,fetchTextBodyValues:true,fetchHTMLBodyValues:true,maxBodyValueBytes:THREAD_BODY_LIMIT},"e"]]
     }),cache:"no-store"});
     const ed=await er.json();
     list=(ed.methodResponses||[]).find((x:any)=>x[0]==="Email/get")?.[1]?.list||[];
    }
    const byId=new Map<string,any>(list.map((message:any)=>[String(message.id),message]));
    byId.set(String(hit.id),hit);
    thread=[...new Set(limited.map(String))].map(emailId=>byId.get(emailId)).filter(Boolean).sort((a:any,b:any)=>String(a.receivedAt||"").localeCompare(String(b.receivedAt||"")));
    threadTruncated=threadTotal>thread.length;
   }
  }catch(error){
   console.warn("Thread details load failed",error);
  }
 }
 return NextResponse.json({...hit,thread,threadTotal,threadTruncated,_prefetched:prefetch});
}
