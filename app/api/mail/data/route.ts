import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";

async function stalwart(path:string,token:string,init?:RequestInit){
 return fetch("http://host.docker.internal:18080"+path,{
  ...init,
  headers:{Authorization:"Basic "+token,"content-type":"application/json",...(init?.headers||{})},
  cache:"no-store"
 });
}

function parseMailSearch(input:string){
 const ops:Record<string,string[]>={};
 const re=/\b(from|to|subject|has|is|after|before|newer_than|older_than|in):(?:"([^"]+)"|(\S+))/gi;
 const free=input.replace(re,(_all,key:string,quoted:string,bare:string)=>{(ops[key.toLowerCase()]||=[]).push((quoted||bare||"").trim());return " "}).replace(/\s+/g," ").trim();
 return {ops,free};
}
function relativeDate(value:string,past=true){
 const m=/^(\d+)([dmy])$/i.exec(value.trim());if(!m)return "";
 const n=Math.max(1,Math.min(3650,Number(m[1]))),unit=m[2].toLowerCase(),ms=n*(unit==="d"?86400000:unit==="m"?30*86400000:365*86400000);
 return new Date(Date.now()+(past?-ms:ms)).toISOString();
}

export async function GET(req:NextRequest){
 const auth=await getMailSession();
 if(!auth)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const sr=await stalwart("/jmap/session",auth.token);
  if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
  const session=await sr.json();
  const accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
  if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
  const api=new URL(session.apiUrl),endpoint=api.pathname+api.search;
  const mailboxId=req.nextUrl.searchParams.get("mailboxId")||"";
  const search=(req.nextUrl.searchParams.get("q")||"").trim();
  const scope=req.nextUrl.searchParams.get("scope")||"all";
  const parsed=parseMailSearch(search);
  const requestedDays=Number(req.nextUrl.searchParams.get("days"));
  const days=[7,30,365].includes(requestedDays)?requestedDays:0;
  const position=Math.max(0,Number(req.nextUrl.searchParams.get("position")||0)||0);
  const limit=Math.min(100,Math.max(10,Number(req.nextUrl.searchParams.get("limit")||50)||50));
  const oldest=req.nextUrl.searchParams.get("sort")==="oldest";
  const unread=req.nextUrl.searchParams.get("unread")==="1";
  const starred=req.nextUrl.searchParams.get("starred")==="1";
  let attachment=req.nextUrl.searchParams.get("attachment")==="1";

  let effectiveMailboxId=mailboxId,preloadedMailboxes:any[]=[];
  const needsMailboxLookup=!effectiveMailboxId&&!starred||!!search||!!parsed.ops.in?.length;
  if(needsMailboxLookup){
   const r=await stalwart(endpoint,auth.token,{method:"POST",body:JSON.stringify({
    using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],
    methodCalls:[["Mailbox/get",{accountId,properties:["id","name","role","sortOrder","totalEmails","unreadEmails"]},"m"]]
   })});
   if(!r.ok)throw new Error("Mailbox lookup failed");
   const md=await r.json();
   const mx=(md.methodResponses||[]).find((x:any)=>x[0]==="Mailbox/get");
   preloadedMailboxes=mx?.[1]?.list||[];
  }
  if(search){
   effectiveMailboxId="";
   const inValue=parsed.ops.in?.at(-1)?.toLowerCase();
   if(inValue){
    const roleMap:Record<string,string>={inbox:"inbox",sent:"sent",drafts:"drafts",trash:"trash",spam:"junk",junk:"junk",archive:"archive"};
    effectiveMailboxId=preloadedMailboxes.find((x:any)=>x.role===roleMap[inValue]||x.name?.toLowerCase()===inValue)?.id||"";
   }
  }else if(!effectiveMailboxId&&!starred){
   effectiveMailboxId=preloadedMailboxes.find((x:any)=>x.role==="inbox")?.id||preloadedMailboxes[0]?.id||"";
  }

  const filter:any={};
  if(effectiveMailboxId)filter.inMailbox=effectiveMailboxId;
  const from=parsed.ops.from?.at(-1),to=parsed.ops.to?.at(-1),subjectOp=parsed.ops.subject?.at(-1);
  if(from)filter.from=from;if(to)filter.to=to;if(subjectOp)filter.subject=subjectOp;
  if(parsed.free){
   if(["from","to","subject","body"].includes(scope)&&!filter[scope])filter[scope]=parsed.free;
   else filter.text=parsed.free;
  }
  const after=parsed.ops.after?.at(-1),before=parsed.ops.before?.at(-1),newer=parsed.ops.newer_than?.at(-1),older=parsed.ops.older_than?.at(-1);
  if(after){const t=Date.parse(after);if(!Number.isNaN(t))filter.after=new Date(t).toISOString()}
  else if(newer){const iso=relativeDate(newer,true);if(iso)filter.after=iso}
  else if(days)filter.after=new Date(Date.now()-days*86400000).toISOString();
  if(before){const t=Date.parse(before);if(!Number.isNaN(t))filter.before=new Date(t).toISOString()}
  else if(older){const iso=relativeDate(older,true);if(iso)filter.before=iso}
  const isOps=(parsed.ops.is||[]).map(x=>x.toLowerCase());
  if(unread||isOps.includes("unread"))filter.notKeyword="$seen";
  if(isOps.includes("read"))filter.hasKeyword="$seen";
  if(starred||isOps.includes("starred"))filter.hasKeyword="$flagged";
  if((parsed.ops.has||[]).some(x=>x.toLowerCase()==="attachment"))attachment=true;

  const call=async(pos:number,chunk:number,includeMailboxes:boolean)=>{
   const calls:any[]=[];
   if(includeMailboxes)calls.push(["Mailbox/get",{accountId,properties:["id","name","role","sortOrder","totalEmails","unreadEmails"]},"m"]);
   calls.push(
    ["Email/query",{accountId,filter,sort:[{property:"receivedAt",isAscending:oldest}],position:pos,limit:chunk,calculateTotal:true},"q"],
    ["Email/get",{accountId,"#ids":{"resultOf":"q","name":"Email/query","path":"/ids"},properties:["id","threadId","mailboxIds","keywords","from","to","cc","subject","receivedAt","preview","hasAttachment","size"]},"e"]
   );
   const r=await stalwart(endpoint,auth.token,{method:"POST",body:JSON.stringify({
    using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],
    methodCalls:calls
   })});
   if(!r.ok)throw new Error("JMAP request failed");
   return r.json();
  };

  let mailboxes:any[]=preloadedMailboxes,total=0,cursor=position,emails:any[]=[];
  const includeBoxes=()=>mailboxes.length===0;
  if(!attachment){
   const response=await call(position,limit,includeBoxes());
   let query:any=null,list:any[]=[];
   for(const x of response.methodResponses||[]){
    if(x[0]==="error")return NextResponse.json({error:x[1]?.description||x[1]?.type||"JMAP error"},{status:400});
    if(x[0]==="Mailbox/get")mailboxes=x[1].list||[];
    if(x[0]==="Email/query")query=x[1];
    if(x[0]==="Email/get")list=x[1].list||[];
   }
   const ids:string[]=query?.ids||[];
   total=query?.total||0;
   const start=query?.position??position;
   cursor=start+ids.length;
   const byId=new Map(list.map((m:any)=>[m.id,m]));
   emails=ids.map(id=>byId.get(id)).filter(Boolean);
  }else{
   const chunk=Math.min(100,Math.max(50,limit));
   const maxScan=1000;
   let scanned=0,first=true;
   while(emails.length<limit&&scanned<maxScan){
    const response=await call(cursor,chunk,first&&includeBoxes());
    first=false;
    let query:any=null,list:any[]=[];
    for(const x of response.methodResponses||[]){
     if(x[0]==="error")return NextResponse.json({error:x[1]?.description||x[1]?.type||"JMAP error"},{status:400});
     if(x[0]==="Mailbox/get")mailboxes=x[1].list||[];
     if(x[0]==="Email/query")query=x[1];
     if(x[0]==="Email/get")list=x[1].list||[];
    }
    const ids:string[]=query?.ids||[];
    total=query?.total||0;
    const start=query?.position??cursor;
    if(!ids.length){cursor=start;break}
    const byId=new Map(list.map((m:any)=>[m.id,m]));
    for(let i=0;i<ids.length;i++){
     cursor=start+i+1;
     scanned++;
     const message=byId.get(ids[i]);
     if(message?.hasAttachment)emails.push(message);
     if(emails.length>=limit||scanned>=maxScan)break;
    }
    if(cursor>=total)break;
   }
  }

  return NextResponse.json({
   accountId,
   username:session.username,
   mailboxes,
   emails,
   position,
   total,
   nextPosition:cursor,
   hasMore:cursor<total,
   filteredTotal:attachment?null:total,
   selectedMailboxId:effectiveMailboxId||null
  });
 }catch(error){
  console.error("Mail data load failed",error);
  return NextResponse.json({error:"Stalwart unavailable"},{status:502});
 }
}
