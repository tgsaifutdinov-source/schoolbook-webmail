import {cookies} from "next/headers";
import {NextResponse} from "next/server";

async function getAuth(){return (await cookies()).get("sbmail_auth")?.value}
async function stalwart(path:string,token:string,init?:RequestInit){
 return fetch("http://host.docker.internal:18080"+path,{...init,headers:{Authorization:"Basic "+token,"content-type":"application/json",...(init?.headers||{})},cache:"no-store"})
}
export async function GET(){
 const token=await getAuth(); if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const sr=await stalwart("/jmap/session",token); if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
  const s=await sr.json(); const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];
  if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
  const apiUrl=new URL(s.apiUrl); const endpoint=apiUrl.pathname+apiUrl.search;
  const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[
   ["Mailbox/get",{accountId,properties:["id","name","role","sortOrder","totalEmails","unreadEmails"]},"m"],
   ["Email/query",{accountId,sort:[{property:"receivedAt",isAscending:false}],limit:50},"q"],
   ["Email/get",{accountId,"#ids":{"resultOf":"q","name":"Email/query","path":"/ids"},properties:["id","mailboxIds","keywords","from","to","subject","receivedAt","preview","hasAttachment","size"]},"e"]
  ]};
  const r=await stalwart(endpoint,token,{method:"POST",body:JSON.stringify(body)}); if(!r.ok)return NextResponse.json({error:"JMAP request failed"},{status:r.status});
  const d=await r.json(); const result:any={accountId,username:s.username,mailboxes:[],emails:[]};
  for(const x of d.methodResponses||[]){if(x[0]==="Mailbox/get")result.mailboxes=x[1].list||[];if(x[0]==="Email/get")result.emails=x[1].list||[]}
  return NextResponse.json(result);
 }catch(e){return NextResponse.json({error:"Stalwart unavailable"},{status:502})}
}