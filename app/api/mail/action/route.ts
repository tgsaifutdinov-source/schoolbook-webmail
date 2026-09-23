import {getMailSession} from "../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../lib/security";
import {NextRequest,NextResponse} from "next/server";

type MailboxMap=Record<string,boolean>;
type Context={headers:Record<string,string>;accountId:string;endpoint:string};

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
 const ids=new Set<string>(directIds);
 if(threadIds.length){
  const d=await jmap(c,[["Thread/get",{accountId:c.accountId,ids:threadIds.slice(0,100)},"threads"]]);
  const list=d.methodResponses?.find((x:any)=>x[0]==="Thread/get")?.[1]?.list||[];
  for(const thread of list)for(const emailId of thread.emailIds||[]){
   if(ids.size>=500)break;
   if(typeof emailId==="string"&&emailId)ids.add(emailId);
  }
 }
 let resolved=[...ids].slice(0,500);
 if(mailboxScopeId&&resolved.length){
  const d=await jmap(c,[["Email/get",{accountId:c.accountId,ids:resolved,properties:["id","mailboxIds"]},"scope"]]);
  const list=d.methodResponses?.find((x:any)=>x[0]==="Email/get")?.[1]?.list||[];
  const allowed=new Set(list.filter((m:any)=>m.mailboxIds?.[mailboxScopeId]).map((m:any)=>String(m.id)));
  resolved=resolved.filter(id=>allowed.has(id));
 }
 return resolved;
}

async function snapshotMailboxes(c:Context,ids:string[]){
 const map:Record<string,MailboxMap>={};
 if(!ids.length)return map;
 const d=await jmap(c,[["Email/get",{accountId:c.accountId,ids,properties:["id","mailboxIds"]},"before"]]);
 const list=d.methodResponses?.find((x:any)=>x[0]==="Email/get")?.[1]?.list||[];
 for(const message of list){
  const mailboxIds:MailboxMap={};
  for(const [key,value] of Object.entries(message.mailboxIds||{}))if(value===true)mailboxIds[key]=true;
  if(message.id&&Object.keys(mailboxIds).length)map[String(message.id)]=mailboxIds;
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
  ?body.ids.filter((x:any)=>typeof x==="string"&&x).slice(0,500)
  :typeof body.id==="string"&&body.id?[body.id]:[];
 const threadIds:string[]=Array.isArray(body.threadIds)
  ?body.threadIds.filter((x:any)=>typeof x==="string"&&x).slice(0,100)
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
  const d=await jmap(c,[["Email/set",{accountId:c.accountId,update:Object.fromEntries(directIds.map(id=>[id,{mailboxIds:safeMap[id]}]))},"restore"]]);
  const response=d.methodResponses?.[0];
  if(response?.[0]==="error"||Object.keys(response?.[1]?.notUpdated||{}).length)return NextResponse.json({error:"Restore failed",details:response?.[1]},{status:400});
  return NextResponse.json({ok:true,ids:directIds});
 }

 const messageIds=await resolveMessageIds(c,directIds,threadIds,mailboxScopeId);
 if(!messageIds.length)return NextResponse.json({ok:true,ids:[]});

 if(action==="delete"){
  const d=await jmap(c,[["Email/set",{accountId:c.accountId,destroy:messageIds},"delete"]]);
  const response=d.methodResponses?.[0];
  if(response?.[0]==="error"||Object.keys(response?.[1]?.notDestroyed||{}).length)return NextResponse.json({error:"Delete failed",details:response?.[1]},{status:400});
  return NextResponse.json({ok:true,ids:messageIds});
 }

 const reversible=["archive","trash","move"].includes(action);
 const restoreMap=reversible?await snapshotMailboxes(c,messageIds):{};
 let update:any={};

 if(action==="read")update={"keywords/$seen":true};
 else if(action==="unread")update={"keywords/$seen":null};
 else if(action==="star")update={"keywords/$flagged":true};
 else if(action==="unstar")update={"keywords/$flagged":null};
 else if(action==="move"){
  const targetMailboxId=typeof body.targetMailboxId==="string"?body.targetMailboxId:"";
  if(!targetMailboxId)return NextResponse.json({error:"Missing target mailbox"},{status:400});
  update={mailboxIds:{[targetMailboxId]:true}};
 }else if(action==="archive"||action==="restore"||action==="trash"){
  const wanted=action==="archive"?"archive":action==="restore"?"inbox":"trash";
  const d=await jmap(c,[["Mailbox/get",{accountId:c.accountId,properties:["id","role"]},"mailboxes"]]);
  const target=d.methodResponses?.[0]?.[1]?.list?.find((x:any)=>x.role===wanted);
  if(!target)return NextResponse.json({error:"Target mailbox not found"},{status:404});
  update={mailboxIds:{[target.id]:true}};
 }else return NextResponse.json({error:"Unknown action"},{status:400});

 const d=await jmap(c,[["Email/set",{accountId:c.accountId,update:Object.fromEntries(messageIds.map(id=>[id,update]))},"update"]]);
 const response=d.methodResponses?.[0];
 if(response?.[0]==="error"||Object.keys(response?.[1]?.notUpdated||{}).length)return NextResponse.json({error:"Update failed",details:response?.[1]},{status:400});
 return NextResponse.json({ok:true,ids:messageIds,restoreMap:reversible?restoreMap:undefined});
}
