import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";

export const dynamic="force-dynamic";

const EMAIL_PROPERTIES=["id","threadId","mailboxIds","keywords","from","to","cc","subject","receivedAt","preview","hasAttachment","size"];

async function jmap(path:string,token:string,body:any){
 return fetch("http://host.docker.internal:18080"+path,{
  method:"POST",
  headers:{Authorization:"Basic "+token,"content-type":"application/json"},
  body:JSON.stringify(body),
  cache:"no-store"
 });
}
function ids(value:any){return Array.isArray(value)?value.map(String).filter(Boolean):[]}
function unique(values:string[]){return [...new Set(values.filter(Boolean))]}
function syncFilter(req:NextRequest){
 const mailboxId=(req.nextUrl.searchParams.get("mailboxId")||"").trim();
 const starred=req.nextUrl.searchParams.get("starred")==="1";
 const unread=req.nextUrl.searchParams.get("unread")==="1";
 const conditions:any[]=[];
 if(mailboxId)conditions.push({inMailbox:mailboxId});
 if(starred)conditions.push({hasKeyword:"$flagged"});
 if(unread)conditions.push({notKeyword:"$seen"});
 const filter=conditions.length===0?{}:conditions.length===1?conditions[0]:{operator:"AND",conditions};
 return {filter,sort:[{property:"receivedAt",isAscending:req.nextUrl.searchParams.get("sort")==="oldest"}]};
}

export async function GET(req:NextRequest){
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const emailState=(req.nextUrl.searchParams.get("emailState")||"").trim();
 const mailboxState=(req.nextUrl.searchParams.get("mailboxState")||"").trim();
 const queryState=(req.nextUrl.searchParams.get("queryState")||"").trim();
 const currentIds=unique((req.nextUrl.searchParams.get("ids")||"").split(",").map(x=>x.trim())).slice(0,100);
 const upToId=(req.nextUrl.searchParams.get("upToId")||"").trim()||currentIds.at(-1)||"";
 const canQueryChanges=req.nextUrl.searchParams.get("queryChanges")==="1"&&!!queryState;
 if(!emailState||!mailboxState)return NextResponse.json({ok:true,changed:true,reset:true,reason:"missingState"});
 try{
  const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers:{Authorization:"Basic "+token},cache:"no-store"});
  if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
  const session=await sr.json(),accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
  if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
  const api=new URL(session.apiUrl),endpoint=api.pathname+api.search,{filter,sort}=syncFilter(req);
  const methodCalls:any[]=[
   ["Email/changes",{accountId,sinceState:emailState,maxChanges:500},"emailChanges"],
   ["Mailbox/changes",{accountId,sinceState:mailboxState,maxChanges:100},"mailboxChanges"]
  ];
  if(canQueryChanges)methodCalls.push(["Email/queryChanges",{
   accountId,filter,sort,collapseThreads:true,sinceQueryState:queryState,
   ...(upToId?{upToId}:{}),maxChanges:250,calculateTotal:true
  },"queryChanges"]);
  const r=await jmap(endpoint,token,{using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls});
  if(!r.ok)return NextResponse.json({error:"JMAP sync request failed"},{status:502});
  const data=await r.json();
  const byCall=(name:string)=>(data.methodResponses||[]).find((x:any)=>x[2]===name);
  const emailResponse=byCall("emailChanges"),mailboxResponse=byCall("mailboxChanges"),queryResponse=byCall("queryChanges");
  if(emailResponse?.[0]==="error"||mailboxResponse?.[0]==="error"){
   const error=emailResponse?.[0]==="error"?emailResponse?.[1]:mailboxResponse?.[1];
   return NextResponse.json({ok:true,changed:true,reset:true,reason:error?.type||"changesUnavailable"});
  }
  const email=emailResponse?.[1]||{},mailbox=mailboxResponse?.[1]||{};
  if(email.hasMoreChanges||mailbox.hasMoreChanges)return NextResponse.json({ok:true,changed:true,reset:true,reason:"tooManyChanges"});
  const emailCreated=ids(email.created),emailUpdated=ids(email.updated),emailDestroyed=ids(email.destroyed);
  const mailboxCreated=ids(mailbox.created),mailboxUpdated=ids(mailbox.updated),mailboxDestroyed=ids(mailbox.destroyed);
  let queryReset=false,queryChanged=false,newQueryState=queryState,total:undefined|number=undefined,removed:string[]=[],added:any[]=[];
  if(canQueryChanges){
   if(!queryResponse||queryResponse[0]==="error")queryReset=true;
   else{
    const q=queryResponse[1]||{};
    newQueryState=String(q.newQueryState||queryState);
    total=Number.isFinite(Number(q.total))?Number(q.total):undefined;
    removed=ids(q.removed);
    added=(Array.isArray(q.added)?q.added:[]).map((x:any)=>({id:String(x?.id||""),index:Number(x?.index)})).filter((x:any)=>x.id&&Number.isFinite(x.index));
    queryChanged=removed.length>0||added.length>0;
   }
  }
  const currentSet=new Set(currentIds);
  const detailIds=unique([
   ...emailCreated.filter(id=>currentSet.has(id)),
   ...emailUpdated.filter(id=>currentSet.has(id)),
   ...added.map((x:any)=>x.id)
  ]).slice(0,300);
  const mailboxDetailIds=unique([...mailboxCreated,...mailboxUpdated]).slice(0,200);
  let emailPatches:any[]=[],mailboxPatches:any[]=[];
  if(detailIds.length||mailboxDetailIds.length){
   const detailCalls:any[]=[];
   if(detailIds.length)detailCalls.push(["Email/get",{accountId,ids:detailIds,properties:EMAIL_PROPERTIES},"emails"]);
   if(mailboxDetailIds.length)detailCalls.push(["Mailbox/get",{accountId,ids:mailboxDetailIds,properties:["id","name","role","sortOrder","totalEmails","unreadEmails"]},"mailboxes"]);
   const dr=await jmap(endpoint,token,{using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:detailCalls});
   if(dr.ok){
    const dd=await dr.json();
    emailPatches=(dd.methodResponses||[]).find((x:any)=>x[2]==="emails")?.[1]?.list||[];
    mailboxPatches=(dd.methodResponses||[]).find((x:any)=>x[2]==="mailboxes")?.[1]?.list||[];
   }
  }
  if(emailPatches.length){
   const threadIds=unique(emailPatches.map((x:any)=>String(x.threadId||""))).slice(0,200);
   if(threadIds.length){
    try{
     const tr=await jmap(endpoint,token,{using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Thread/get",{accountId,ids:threadIds,properties:["id","emailIds"]},"threads"]]});
     if(tr.ok){
      const td=await tr.json(),list=(td.methodResponses||[]).find((x:any)=>x[2]==="threads")?.[1]?.list||[];
      const counts=new Map(list.map((x:any)=>[String(x.id),Array.isArray(x.emailIds)?x.emailIds.length:1]));
      emailPatches=emailPatches.map((x:any)=>({...x,threadCount:Number(counts.get(String(x.threadId||""))||1)}));
     }
    }catch{}
   }
  }
  const changed=emailCreated.length+emailUpdated.length+emailDestroyed.length+mailboxCreated.length+mailboxUpdated.length+mailboxDestroyed.length>0||queryChanged||queryReset;
  return NextResponse.json({
   ok:true,changed,reset:false,
   emailState:String(email.newState||emailState),
   mailboxState:String(mailbox.newState||mailboxState),
   emailChanges:{created:emailCreated,updated:emailUpdated,destroyed:emailDestroyed},
   mailboxChanges:{created:mailboxCreated,updated:mailboxUpdated,destroyed:mailboxDestroyed,updatedProperties:mailbox.updatedProperties??null},
   emailPatches,mailboxPatches,
   mailboxStructural:mailboxCreated.length>0||mailboxDestroyed.length>0,
   query:{available:canQueryChanges,reset:queryReset,changed:queryChanged,newQueryState,total,removed,added}
  });
 }catch(error){
  console.error("Incremental mail sync failed",error);
  return NextResponse.json({error:"Stalwart unavailable"},{status:502});
 }
}
