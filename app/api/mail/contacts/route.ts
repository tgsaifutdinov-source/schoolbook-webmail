import {getMailSession} from "../../../../lib/mail-session";
import {NextResponse} from "next/server";

type Contact={email:string;name?:string;score:number;lastSeen:string;sentCount:number;receivedCount:number};

export async function GET(){
 const auth=await getMailSession();
 if(!auth)return NextResponse.json({error:"Unauthorized"},{status:401});
 const headers={Authorization:"Basic "+auth.token,"content-type":"application/json"};
 try{
  const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
  if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
  const session=await sr.json();
  const accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
  if(!accountId)return NextResponse.json({contacts:[]});
  const u=new URL(session.apiUrl);
  const endpoint="http://host.docker.internal:18080"+u.pathname+u.search;
  const mailboxReq=await fetch(endpoint,{method:"POST",headers,cache:"no-store",body:JSON.stringify({
   using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],
   methodCalls:[["Mailbox/get",{accountId,properties:["id","role"]},"m"]]
  })});
  if(!mailboxReq.ok)throw new Error("Mailbox lookup failed");
  const mailboxData=await mailboxReq.json();
  const boxes=mailboxData.methodResponses?.find((x:any)=>x[0]==="Mailbox/get")?.[1]?.list||[];
  const sent=boxes.find((x:any)=>x.role==="sent")?.id;
  const inbox=boxes.find((x:any)=>x.role==="inbox")?.id;
  const calls:any[]=[];
  if(sent){
   calls.push(
    ["Email/query",{accountId,filter:{inMailbox:sent},sort:[{property:"receivedAt",isAscending:false}],limit:120},"sentQ"],
    ["Email/get",{accountId,"#ids":{"resultOf":"sentQ","name":"Email/query","path":"/ids"},properties:["to","cc","bcc","receivedAt"]},"sentE"]
   );
  }
  if(inbox){
   calls.push(
    ["Email/query",{accountId,filter:{inMailbox:inbox},sort:[{property:"receivedAt",isAscending:false}],limit:120},"inQ"],
    ["Email/get",{accountId,"#ids":{"resultOf":"inQ","name":"Email/query","path":"/ids"},properties:["from","receivedAt"]},"inE"]
   );
  }
  if(!calls.length)return NextResponse.json({contacts:[]});
  const r=await fetch(endpoint,{method:"POST",headers,cache:"no-store",body:JSON.stringify({
   using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],
   methodCalls:calls
  })});
  if(!r.ok)throw new Error("Contact query failed");
  const d=await r.json();
  const me=String(session.username||auth.username||"").toLowerCase();
  const map=new Map<string,Contact>();
  const add=(a:any,weight:number,date:string,direction:"sent"|"received")=>{
   const email=String(a?.email||"").trim();
   if(!email||email.toLowerCase()===me)return;
   const key=email.toLowerCase();
   const old=map.get(key);
   const name=String(a?.name||"").trim()||old?.name;
   const lastSeen=old?.lastSeen&&old.lastSeen>date?old.lastSeen:date;
   map.set(key,{email,name,score:(old?.score||0)+weight,lastSeen:lastSeen||old?.lastSeen||"",sentCount:(old?.sentCount||0)+(direction==="sent"?1:0),receivedCount:(old?.receivedCount||0)+(direction==="received"?1:0)});
  };
  const sentList=d.methodResponses?.find((x:any)=>x[0]==="Email/get"&&x[2]==="sentE")?.[1]?.list||[];
  for(const m of sentList)for(const a of [...(m.to||[]),...(m.cc||[]),...(m.bcc||[])])add(a,3,String(m.receivedAt||""),"sent");
  const inboxList=d.methodResponses?.find((x:any)=>x[0]==="Email/get"&&x[2]==="inE")?.[1]?.list||[];
  for(const m of inboxList)for(const a of m.from||[])add(a,1,String(m.receivedAt||""),"received");
  const contacts=[...map.values()].sort((a,b)=>b.score-a.score||b.lastSeen.localeCompare(a.lastSeen)||a.email.localeCompare(b.email)).slice(0,100);
  return NextResponse.json({contacts});
 }catch(error){
  console.error("Recent contacts load failed",error);
  return NextResponse.json({contacts:[]});
 }
}
