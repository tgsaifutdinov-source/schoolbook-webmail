import {getMailSession} from "../../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../../lib/security";
import {NextRequest,NextResponse} from "next/server";

export async function POST(req:NextRequest){
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await req.json().catch(()=>({})),emailId=String(body.emailId||"").trim(),submissionId=String(body.submissionId||"").trim();
 if(!emailId||!submissionId)return NextResponse.json({error:"Недостаточно данных для отмены отправки"},{status:400});
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
 if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const session=await sr.json(),accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
 if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
 const u=new URL(session.apiUrl),endpoint="http://host.docker.internal:18080"+u.pathname+u.search;

 const cancelBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[
  ["EmailSubmission/set",{accountId,destroy:[submissionId]},"cancel"],
  ["Mailbox/get",{accountId,properties:["id","role"]},"boxes"]
 ]};
 const rr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(cancelBody),cache:"no-store"});
 if(!rr.ok)return NextResponse.json({error:"Не удалось отменить отправку"},{status:rr.status});
 const result=await rr.json(),cancel=result.methodResponses?.find((x:any)=>x[2]==="cancel")?.[1],boxes=result.methodResponses?.find((x:any)=>x[2]==="boxes")?.[1]?.list||[];
 const cancelError=cancel?.notDestroyed?.[submissionId];
 if(cancelError||!Array.isArray(cancel?.destroyed)||!cancel.destroyed.includes(submissionId)){
  return NextResponse.json({error:"Время отмены уже истекло — письмо отправлено"},{status:409});
 }
 const drafts=boxes.find((x:any)=>x.role==="drafts")?.id,sent=boxes.find((x:any)=>x.role==="sent")?.id;
 if(!drafts)return NextResponse.json({error:"Отправка отменена, но папка Черновики не найдена"},{status:500});
 const patch:any={"keywords/$draft":true};
 patch["mailboxIds/"+drafts]=true;
 if(sent)patch["mailboxIds/"+sent]=null;
 const restoreBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[
  ["Email/set",{accountId,update:{[emailId]:patch}},"restore"]
 ]};
 const pr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(restoreBody),cache:"no-store"});
 const pd=await pr.json().catch(()=>({})),restore=pd.methodResponses?.find((x:any)=>x[2]==="restore")?.[1],restoreError=restore?.notUpdated?.[emailId];
 if(!pr.ok||restoreError)return NextResponse.json({error:restoreError?.description||"Отправка отменена, но письмо не удалось вернуть в черновики"},{status:500});
 return NextResponse.json({ok:true,emailId});
}
