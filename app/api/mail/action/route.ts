import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";

async function context(){
 const token=(await cookies()).get("sbmail_auth")?.value;if(!token)return null;
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});if(!sr.ok)return null;
 const s=await sr.json();const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];const u=new URL(s.apiUrl);
 return {headers,accountId,endpoint:"http://host.docker.internal:18080"+u.pathname+u.search};
}
export async function POST(req:NextRequest){
 const c=await context();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {id,ids,action,targetMailboxId}=await req.json();const messageIds:Array<string>=Array.isArray(ids)?ids.filter(Boolean):id?[id]:[];if(!messageIds.length)return NextResponse.json({error:"Missing id"},{status:400});
 let update:any={};
 if(action==="delete"){const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId:c.accountId,destroy:messageIds},"s"]]};const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify(body),cache:"no-store"});const d=await r.json();const x=d.methodResponses?.[0];if(x?.[0]==="error"||Object.keys(x?.[1]?.notDestroyed||{}).length)return NextResponse.json({error:"Delete failed",details:x?.[1]},{status:400});return NextResponse.json({ok:true})}
 if(action==="read")update={"keywords/$seen":true};
 else if(action==="unread")update={"keywords/$seen":null};
 else if(action==="star")update={"keywords/$flagged":true};
 else if(action==="unstar")update={"keywords/$flagged":null};
 else if(action==="move"){
  if(!targetMailboxId)return NextResponse.json({error:"Missing target mailbox"},{status:400});
  update={mailboxIds:{[targetMailboxId]:true}};
 } else if(action==="archive"||action==="restore"||action==="trash"){
  const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Mailbox/get",{accountId:c.accountId,properties:["id","role"]},"m"]]};
  const rr=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify(body),cache:"no-store"});const dd=await rr.json();const wanted=action==="archive"?"archive":action==="restore"?"inbox":"trash";const target=dd.methodResponses?.[0]?.[1]?.list?.find((x:any)=>x.role===wanted);
  if(!target)return NextResponse.json({error:"Target mailbox not found"},{status:404});
  update={mailboxIds:{[target.id]:true}};
 } else return NextResponse.json({error:"Unknown action"},{status:400});
 const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId:c.accountId,update:Object.fromEntries(messageIds.map(messageId=>[messageId,update]))},"s"]]};
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify(body),cache:"no-store"});const d=await r.json();
 const response=d.methodResponses?.[0];if(response?.[0]==="error"||Object.keys(response?.[1]?.notUpdated||{}).length)return NextResponse.json({error:"Update failed",details:response?.[1]},{status:400});
 return NextResponse.json({ok:true});
}