import {getMailSession} from "../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../lib/security";
import {buildJmapEmail} from "../../../../lib/jmap-email";
import {NextRequest,NextResponse} from "next/server";

type SendRecord={status:"processing"|"sent";expiresAt:number;response?:{ok:true,emailId:string,scheduledAt?:string}};
declare global{var __schoolbookSendRequests:Map<string,SendRecord>|undefined}
const sendRequests=globalThis.__schoolbookSendRequests||(globalThis.__schoolbookSendRequests=new Map<string,SendRecord>());
function trimSendRequests(){
 const now=Date.now();
 for(const [key,value] of sendRequests)if(value.expiresAt<=now)sendRequests.delete(key);
 while(sendRequests.size>2000){const first=sendRequests.keys().next().value as string|undefined;if(!first)break;sendRequests.delete(first)}
}

export async function POST(req:NextRequest){
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await req.json().catch(()=>({}));const to=String(body.to||""),cc=String(body.cc||""),bcc=String(body.bcc||""),subject=String(body.subject||""),text=String(body.text||""),html=String(body.html||""),attachments=Array.isArray(body.attachments)?body.attachments.slice(0,100):[],inReplyTo=Array.isArray(body.inReplyTo)?body.inReplyTo.map((x:any)=>String(x||"")):[],references=Array.isArray(body.references)?body.references.map((x:any)=>String(x||"")):[],draftId=String(body.draftId||""),identityId=String(body.identityId||"").trim(),clientRequestId=String(body.clientRequestId||"").trim(),scheduleAt=String(body.scheduleAt||"").trim();
 if(clientRequestId&&!/^[A-Za-z0-9._:-]{8,160}$/.test(clientRequestId))return NextResponse.json({error:"Некорректный идентификатор отправки"},{status:400});
 if(subject.length>998||text.length>5_000_000||html.length>5_000_000)return NextResponse.json({error:"Письмо слишком большое"},{status:413});
 if(!to?.trim())return NextResponse.json({error:"Укажите получателя"},{status:400});

 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
 if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const s=await sr.json();
 const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];
 const submissionCapabilities=s.accounts?.[accountId]?.accountCapabilities?.["urn:ietf:params:jmap:submission"]||{},maxDelayedSend=Math.max(0,Number(submissionCapabilities.maxDelayedSend)||0);
 const scheduledMs=scheduleAt?Date.parse(scheduleAt):0,delaySeconds=scheduleAt?Math.ceil((scheduledMs-Date.now())/1000):0;
 if(scheduleAt&&(!Number.isFinite(scheduledMs)||delaySeconds<60))return NextResponse.json({error:"Выберите время отправки минимум на минуту позже текущего"},{status:400});
 if(scheduleAt&&maxDelayedSend<=0)return NextResponse.json({error:"Этот сервер не поддерживает отложенную отправку через JMAP"},{status:400});
 if(scheduleAt&&delaySeconds>maxDelayedSend)return NextResponse.json({error:"Сервер позволяет отложить отправку максимум на "+Math.floor(maxDelayedSend/3600)+" ч."},{status:400});
 const requestKey=clientRequestId?String(accountId)+":"+clientRequestId:"";
 trimSendRequests();
 if(requestKey){
  const previous=sendRequests.get(requestKey);
  if(previous?.status==="sent"&&previous.response)return NextResponse.json({...previous.response,deduplicated:true});
 }
 const u=new URL(s.apiUrl);
 const endpoint="http://host.docker.internal:18080"+u.pathname+u.search;

 const metaBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[
  ["Identity/get",{accountId},"i"],
  ["Mailbox/get",{accountId,properties:["id","role"]},"m"]
 ]};
 const mr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(metaBody),cache:"no-store"});
 const md=await mr.json();
 const identities=md.methodResponses?.find((x:any)=>x[0]==="Identity/get")?.[1]?.list||[];
 const identity=identityId?identities.find((x:any)=>String(x.id)===identityId):identities[0];
 const boxes=md.methodResponses?.find((x:any)=>x[0]==="Mailbox/get")?.[1]?.list||[];
 const drafts=boxes.find((x:any)=>x.role==="drafts")?.id;
 const sent=boxes.find((x:any)=>x.role==="sent")?.id;
 if(!identity)return NextResponse.json({error:identityId?"Выбранный отправитель больше недоступен":"Не найдена почтовая идентичность"},{status:400});
 if(!drafts)return NextResponse.json({error:"Не найдена папка Черновики"},{status:400});

 const addresses=(v:string)=>String(v||"").split(/[;,\n]+/).map((x:string)=>x.trim()).filter(Boolean).map((email:string)=>({email}));const valid=(email:string)=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);const recipients=addresses(to);
 const allRecipients=[...recipients,...addresses(cc),...addresses(bcc)];if(!recipients.length||allRecipients.some((x:any)=>!valid(x.email)))return NextResponse.json({error:"Проверьте адреса получателей"},{status:400});if(allRecipients.length>200)return NextResponse.json({error:"Слишком много получателей в одном письме"},{status:400});
 const email=buildJmapEmail({drafts,identity,to,cc,bcc,subject,text,html,attachments,inReplyTo,references,includeFrom:true,applyIdentityDefaults:true});
 if(requestKey){
  const previous=sendRequests.get(requestKey);
  if(previous?.status==="sent"&&previous.response)return NextResponse.json({...previous.response,deduplicated:true});
  if(previous?.status==="processing"&&previous.expiresAt>Date.now())return NextResponse.json({ok:false,pending:true},{status:202});
  sendRequests.set(requestKey,{status:"processing",expiresAt:Date.now()+10*60*1000});
 }

 const createBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId,create:{send:email}},"e"]]};
 const cr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(createBody),cache:"no-store"});const cd=await cr.json();
 const created=cd.methodResponses?.find((x:any)=>x[0]==="Email/set");const emailError=created?.[1]?.notCreated?.send;const emailId=created?.[1]?.created?.send?.id;
 if(emailError||!emailId){if(requestKey)sendRequests.delete(requestKey);console.error("JMAP Email/set failed",JSON.stringify(cd));return NextResponse.json({error:emailError?.description||"Не удалось создать письмо",type:emailError?.type||"jmapError",properties:emailError?.properties||[]},{status:400})}
 const submission:any={identityId:identity.id,emailId};if(scheduleAt)submission.envelope={mailFrom:{email:identity.email,parameters:{HOLDFOR:String(delaySeconds)}},rcptTo:allRecipients.map((x:any)=>({email:x.email,parameters:null}))};
 const submitBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[["EmailSubmission/set",{accountId,create:{send:submission}},"s"]]};
 const rr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(submitBody),cache:"no-store"});const sd=await rr.json();const submissionResult=sd.methodResponses?.find((x:any)=>x[0]==="EmailSubmission/set");const sendError=submissionResult?.[1]?.notCreated?.send;
 if(sendError||!submissionResult){if(requestKey)sendRequests.delete(requestKey);console.error("JMAP EmailSubmission/set failed",JSON.stringify(sd));await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId,destroy:[emailId]},"cleanupFailedSend"]]}),cache:"no-store"}).catch(()=>null);return NextResponse.json({error:sendError?.description||"Не удалось отправить письмо",type:sendError?.type||"jmapError"},{status:400})}
 if(requestKey)sendRequests.set(requestKey,{status:"sent",expiresAt:Date.now()+15*60*1000,response:{ok:true,emailId,...(scheduleAt?{scheduledAt:new Date(scheduledMs).toISOString()}:{})}});

 if(emailId&&sent){
  const patch:any={"keywords/$draft":null};
  patch["mailboxIds/"+drafts]=null;patch["mailboxIds/"+sent]=true;
  await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId,update:{[emailId]:patch}},"move"]]}),cache:"no-store"});
 }
 if(draftId&&draftId!==emailId){
  await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId,destroy:[draftId]},"cleanup"]]}),cache:"no-store"}).catch(()=>null);
 }
 return NextResponse.json({ok:true,emailId,identityId:identity.id,...(scheduleAt?{scheduledAt:new Date(scheduledMs).toISOString()}:{})});
}