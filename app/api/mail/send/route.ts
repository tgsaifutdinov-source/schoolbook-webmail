import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";

export async function POST(req:NextRequest){
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {to,cc="",bcc="",subject,text,attachments=[],draftId=""}=await req.json();
 if(!to?.trim())return NextResponse.json({error:"Укажите получателя"},{status:400});

 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
 if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const s=await sr.json();
 const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];
 const u=new URL(s.apiUrl);
 const endpoint="http://host.docker.internal:18080"+u.pathname+u.search;

 const metaBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[
  ["Identity/get",{accountId},"i"],
  ["Mailbox/get",{accountId,properties:["id","role"]},"m"]
 ]};
 const mr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(metaBody),cache:"no-store"});
 const md=await mr.json();
 const identity=md.methodResponses?.find((x:any)=>x[0]==="Identity/get")?.[1]?.list?.[0];
 const boxes=md.methodResponses?.find((x:any)=>x[0]==="Mailbox/get")?.[1]?.list||[];
 const drafts=boxes.find((x:any)=>x.role==="drafts")?.id;
 const sent=boxes.find((x:any)=>x.role==="sent")?.id;
 if(!identity)return NextResponse.json({error:"Не найдена почтовая идентичность"},{status:400});
 if(!drafts)return NextResponse.json({error:"Не найдена папка Черновики"},{status:400});

 const addresses=(v:string)=>String(v||"").split(/[;,\n]+/).map((x:string)=>x.trim()).filter(Boolean).map((email:string)=>({email}));const valid=(email:string)=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);const recipients=addresses(to);
 const allRecipients=[...recipients,...addresses(cc),...addresses(bcc)];if(!recipients.length||allRecipients.some((x:any)=>!valid(x.email)))return NextResponse.json({error:"Проверьте адреса получателей"},{status:400});
 const email:any={
  mailboxIds:{[drafts]:true},keywords:{"$draft":true},
  from:[{name:identity.name||"",email:identity.email}],to:recipients,cc:addresses(cc),bcc:addresses(bcc),subject:subject||"",
  bodyValues:{body:{value:text,isTruncated:false}},textBody:[{partId:"body",type:"text/plain"}]
 };
 if(attachments.length)email.attachments=attachments.map((a:any)=>({blobId:a.blobId,type:a.type||"application/octet-stream",name:a.name,disposition:"attachment"}));

 const setArgs:any={accountId};if(draftId)setArgs.update={[draftId]:email};else setArgs.create={draft:email};
 const createBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",setArgs,"e"]]};
 const cr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(createBody),cache:"no-store"});const cd=await cr.json();
 const created=cd.methodResponses?.find((x:any)=>x[0]==="Email/set");const emailError=draftId?created?.[1]?.notUpdated?.[draftId]:created?.[1]?.notCreated?.draft;const emailId=draftId||created?.[1]?.created?.draft?.id;
 if(emailError||!emailId){console.error("JMAP Email/set failed",JSON.stringify(cd));return NextResponse.json({error:emailError?.description||"Не удалось создать письмо",type:emailError?.type||"jmapError"},{status:400})}
 const submitBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[["EmailSubmission/set",{accountId,create:{send:{identityId:identity.id,emailId}}},"s"]]};
 const rr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(submitBody),cache:"no-store"});const sd=await rr.json();const submissionResult=sd.methodResponses?.find((x:any)=>x[0]==="EmailSubmission/set");const sendError=submissionResult?.[1]?.notCreated?.send;
 if(sendError||!submissionResult){console.error("JMAP EmailSubmission/set failed",JSON.stringify(sd));return NextResponse.json({error:sendError?.description||"Не удалось отправить письмо",type:sendError?.type||"jmapError"},{status:400})}

 if(emailId&&sent){
  const patch:any={"keywords/$draft":null};
  patch["mailboxIds/"+drafts]=null;patch["mailboxIds/"+sent]=true;
  await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId,update:{[emailId]:patch}},"move"]]}),cache:"no-store"});
 }
 return NextResponse.json({ok:true});
}