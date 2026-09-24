import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";

export const dynamic="force-dynamic";

async function jmap(path:string,token:string,body:any){
 return fetch("http://host.docker.internal:18080"+path,{
  method:"POST",
  headers:{Authorization:"Basic "+token,"content-type":"application/json"},
  body:JSON.stringify(body),
  cache:"no-store"
 });
}
function countChanges(value:any){
 return (Array.isArray(value?.created)?value.created.length:0)+(Array.isArray(value?.updated)?value.updated.length:0)+(Array.isArray(value?.destroyed)?value.destroyed.length:0);
}

export async function GET(req:NextRequest){
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const emailState=(req.nextUrl.searchParams.get("emailState")||"").trim();
 const mailboxState=(req.nextUrl.searchParams.get("mailboxState")||"").trim();
 if(!emailState||!mailboxState)return NextResponse.json({ok:true,changed:true,reset:true,reason:"missingState"});
 try{
  const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers:{Authorization:"Basic "+token},cache:"no-store"});
  if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
  const session=await sr.json(),accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
  if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
  const api=new URL(session.apiUrl),endpoint=api.pathname+api.search;
  const r=await jmap(endpoint,token,{
   using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],
   methodCalls:[
    ["Email/changes",{accountId,sinceState:emailState,maxChanges:500},"emailChanges"],
    ["Mailbox/changes",{accountId,sinceState:mailboxState,maxChanges:100},"mailboxChanges"]
   ]
  });
  if(!r.ok)return NextResponse.json({error:"JMAP sync request failed"},{status:502});
  const data=await r.json();
  const emailResponse=(data.methodResponses||[]).find((x:any)=>x[2]==="emailChanges");
  const mailboxResponse=(data.methodResponses||[]).find((x:any)=>x[2]==="mailboxChanges");
  if(emailResponse?.[0]==="error"||mailboxResponse?.[0]==="error"){
   const error=emailResponse?.[0]==="error"?emailResponse?.[1]:mailboxResponse?.[1];
   return NextResponse.json({ok:true,changed:true,reset:true,reason:error?.type||"changesUnavailable"});
  }
  const email=emailResponse?.[1]||{},mailbox=mailboxResponse?.[1]||{};
  const emailCount=countChanges(email),mailboxCount=countChanges(mailbox);
  const changed=emailCount>0||mailboxCount>0||!!email.hasMoreChanges||!!mailbox.hasMoreChanges;
  return NextResponse.json({
   ok:true,
   changed,
   reset:false,
   emailChanged:emailCount>0||!!email.hasMoreChanges,
   mailboxChanged:mailboxCount>0||!!mailbox.hasMoreChanges,
   emailChanges:emailCount,
   mailboxChanges:mailboxCount,
   emailState:String(email.newState||emailState),
   mailboxState:String(mailbox.newState||mailboxState),
   hasMoreChanges:!!email.hasMoreChanges||!!mailbox.hasMoreChanges
  });
 }catch(error){
  console.error("Incremental mail sync failed",error);
  return NextResponse.json({error:"Stalwart unavailable"},{status:502});
 }
}
