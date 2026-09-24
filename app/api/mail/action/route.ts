import {getMailSession} from "../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../lib/security";
import {NextRequest,NextResponse} from "next/server";

type MailboxMap=Record<string,boolean>;
type Context={headers:Record<string,string>;accountId:string;endpoint:string};
const MAX_MESSAGES=2000;
function chunks<T>(items:T[],size=500){const out:T[][]=[];for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));return out}

async function context():Promise<Context|null>{
 const token=(await getMailSession())?.token;
 if(!token)return null;
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
 if(!sr.ok)return null;
 const s=await sr.json();
 const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];
 if(!accountId)return null;
 const u=new URL(s.apiUrl);
 return {headers,accountId:String(accountId),endpoint:"http://host.docker.internal:18080"+u.pathname+u.search};
}

async function jmap(c:Context,methodCalls:any[]){
 const r=await fetch(c.endpoint,{
  method:"POST",
  headers:c.headers,
  body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls}),
  cache:"no-store"
 });
 return r.json();
}

async function resolveMessageIds(c:Context,directIds:string[],threadIds:string[],mailboxScopeId:string){
 const ids=new Set<string>(directIds.slice(0,MAX_MESSAGES));
 for(const batch of chunks(threadIds.slice(0,500),100)){
  if(ids.size>=MAX_MESSAGES)break;
  const d=await jmap(c,[["Thread/get",{accountId:c.accountId,ids:batch},"threads"]]);
  const list=d.methodResponses?.find((x:any)=>x[0]==="Thread/get")?.[1]?.list||[];
  for(const thread of list)for(const emailId of thread.emailIds||[]){
   if(ids.size>=MAX_MESSAGES)break;
   if(typeof emailId==="string"&&emailId)ids.add(emailId);
  }
 }
 let resolved=[...ids].slice(0,MAX_MESSAGES);
 if(mailboxScopeId&&resolved.length){
  const allowed=new Set<string>();
  for(const batch of chunks(resolved)){
   const d=await jmap(c,[["Email/get",{accountId:c.accountId,ids:batch,properties:["id","mailboxIds"]},"scope"]]);
   const list=d.methodResponses?.find((x:any)=>x[0]==="Email/get")?.[1]?.list||[];
   for(const message of list)if(message.mailboxIds?.[mailboxScopeId])allowed.add(String(message.id));
  }
  resolved=resolved.filter(id=>allowed.has(id));
 }
 return resolved;
}

async function snapshotMailboxes(c:Context,ids:string[]){
 const map:Record<string,MailboxMap>={};
 for(const batch of chunks(ids)){
  const d=await jmap(c,[["Email/get",{accountId:c.accountId,ids:batch,properties:["id","mailboxIds"]},"before"]]);
  const list=d.methodResponses?.find((x:any)=>x[0]==="Email/get")?.[1]?.list||[];
  for(const message of list){
   const mailboxIds:MailboxMap={};
   for(const [key,value] of Object.entries(message.mailboxIds||{}))if(value===true)mailboxIds[key]=true;
   if(message.id&&Object.keys(mailboxIds).length)map[String(message.id)]=mailboxIds;
  }
 }
 return map;
}

export async function POST(req:NextRequest){
 const blocked=sameOriginGuard(req);
 if(blocked)return blocked;
 const c=await context();
 if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});

 const body=await req.json().catch(()=>({}));
 const action=String(body.action||"");
 const directIds:string[]=Array.isArray(body.ids)
  ?body.ids.filter((x:any)=>typeof x==="string"&&x).slice(0,MAX_MESSAGES)
  :typeof body.id==="string"&&body.id?[body.id]:[];
 const threadIds:string[]=Array.isArray(body.threadIds)
  ?body.threadIds.filter((x:any)=>typeof x==="string"&&x).slice(0,500)
  :typeof body.threadId==="string"&&body.threadId?[body.threadId]:[];
 const mailboxScopeId=typeof body.mailboxScopeId==="string"?body.mailboxScopeId:"";

 if(action==="restoreMailboxes"){
  if(!directIds.length)return NextResponse.json({error:"Missing id"},{status:400});
  const restoreMap=body.restoreMap;
  const safeMap:Record<string,MailboxMap>={};
  for(const messageId of directIds){
   const raw=restoreMap?.[messageId];
   if(!raw||typeof raw!=="object")return NextResponse.json({error:"Missing restore mailbox map"},{status:400});
   const mailboxIds:MailboxMap={};
   for(const [key,value] of Object.entries(raw as Record<string,unknown>)){
    if(Object.keys(mailboxIds).length>=50)break;
    if(key.length>0&&value===true)mailboxIds[key]=true;
   }
   if(!Object.keys(mailboxIds).length)return NextResponse.json({error:"Invalid restore mailbox map"},{status:400});
   safeMap[messageId]=mailboxIds;
  }
  for(const batch of chunks(directIds)){
   const d=await jmap(c,[["Email/set",{accountId:c.accountId,update:Object.fromEntries(batch.map(id=>[id,{mailboxIds:safeMap[id]}]))},"restore"]]);
   const response=d.methodResponses?.[0];
   if(response?.[0]==="error"||Object.keys(response?.[1]?.notUpdated||{}).length)return NextResponse.json({error:"Restore failed",details:response?.[1]},{status:400});
  }
  return NextResponse.json({ok:true,ids:directIds});
 }

 const messageIds=await resolveMessageIds(c,directIds,threadIds,mailboxScopeId);
 if(!messageIds.length)return NextResponse.json({ok:true,ids:[]});

 if(action==="delete"){
  for(const batch of chunks(messageIds)){
   const d=await jmap(c,[["Email/set",{accountId:c.accountId,destroy:batch},"delete"]]);
   const response=d.methodResponses?.[0];
   if(response?.[0]==="error"||Object.keys(response?.[1]?.notDestroyed||{}).length)return NextResponse.json({error:"Delete failed",details:response?.[1]},{status:400});
  }
  return NextResponse.json({ok:true,ids:messageIds});
 }

 const reversible=["archive","trash","move","spam","notSpam","labelAdd","labelRemove"].includes(action);
 const restoreMap=reversible?await snapshotMailboxes(c,messageIds):{};
 let update:any={};
 let perMessage:Record<string,any>|null=null;

 if(action==="read")update={"keywords/$seen":true};
 else if(action==="unread")update={"keywords/$seen":null};
 else if(action==="star")update={"keywords/$flagged":true};
 else if(action==="unstar")update={"keywords/$flagged":null};
 else if(action==="move"||action==="labelAdd"||action==="labelRemove"){
  const targetMailboxId=typeof body.targetMailboxId==="string"?body.targetMailboxId:"";
  if(!targetMailboxId)return NextResponse.json({error:"Missing target mailbox"},{status:400});
  const md=await jmap(c,[["Mailbox/get",{accountId:c.accountId,ids:[targetMailboxId],properties:["id","role","name"]},"target"]]);
  const target=md.methodResponses?.find((x:any)=>x[0]==="Mailbox/get")?.[1]?.list?.[0];
  if(!target)return NextResponse.json({error:"Target mailbox not found"},{status:404});
  if((action==="labelAdd"||action==="labelRemove")&&target.role)return NextResponse.json({error:"Only custom folders can be used as labels"},{status:400});
  if(action==="labelAdd")update={["mailboxIds/"+targetMailboxId]:true};
  else if(action==="labelRemove")update={["mailboxIds/"+targetMailboxId]:null};
  else{
   perMessage={};
   for(const id of messageIds){
    const next:MailboxMap={...(restoreMap[id]||{})};
    if(mailboxScopeId&&mailboxScopeId!==targetMailboxId)delete next[mailboxScopeId];
    next[targetMailboxId]=true;
    perMessage[id]={mailboxIds:next};
   }
  }
 }else if(action==="archive"||action==="restore"||action==="trash"||action==="spam"||action==="notSpam"){
  const wanted=action==="archive"?"archive":action==="restore"||action==="notSpam"?"inbox":action==="spam"?"junk":"trash";
  const md=await jmap(c,[["Mailbox/get",{accountId:c.accountId,properties:["id","role"]},"mailboxes"]]);
  const list=md.methodResponses?.find((x:any)=>x[0]==="Mailbox/get")?.[1]?.list||[];
  const target=list.find((x:any)=>x.role===wanted);
  if(!target)return NextResponse.json({error:"Target mailbox not found"},{status:404});
  const roles=new Map<string,string>(list.filter((x:any)=>x.role).map((x:any)=>[String(x.id),String(x.role)] as [string,string]));
  perMessage={};
  for(const id of messageIds){
   const next:MailboxMap={...(restoreMap[id]||{})};
   if(action==="archive"){
    for(const key of Object.keys(next))if(roles.get(key)==="inbox")delete next[key];
   }else if(action==="restore"||action==="notSpam"){
    for(const key of Object.keys(next))if(roles.get(key)==="trash"||roles.get(key)==="junk")delete next[key];
   }else{
    for(const key of Object.keys(next))if(roles.has(key))delete next[key];
   }
   next[String(target.id)]=true;
   perMessage[id]={mailboxIds:next};
  }
 }else return NextResponse.json({error:"Unknown action"},{status:400});

 for(const batch of chunks(messageIds)){
  const updates=perMessage?Object.fromEntries(batch.map(id=>[id,perMessage?.[id]||{}])):Object.fromEntries(batch.map(id=>[id,update]));
  const d=await jmap(c,[["Email/set",{accountId:c.accountId,update:updates},"update"]]);
  const response=d.methodResponses?.[0];
  if(response?.[0]==="error"||Object.keys(response?.[1]?.notUpdated||{}).length)return NextResponse.json({error:"Update failed",details:response?.[1]},{status:400});
 }
 return NextResponse.json({ok:true,ids:messageIds,restoreMap:reversible?restoreMap:undefined});
}
