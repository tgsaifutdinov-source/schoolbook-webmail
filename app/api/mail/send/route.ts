import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";

export async function POST(req:NextRequest){
 const token=(await cookies()).get("sbmail_auth")?.value;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {to,subject,text,attachments=[]}=await req.json();
 if(!to?.trim()||!text?.trim())return NextResponse.json({error:"Укажите получателя и текст"},{status:400});

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

 const recipients=String(to).split(",").map((x:string)=>x.trim()).filter(Boolean).map((email:string)=>({email}));
 const email:any={
  mailboxIds:{[drafts]:true},keywords:{"$draft":true},
  from:[{name:identity.name||"",email:identity.email}],to:recipients,subject:subject||"",
  bodyValues:{body:{value:text,isTruncated:false}},textBody:[{partId:"body",type:"text/plain"}]
 };
 if(attachments.length)email.attachments=attachments.map((a:any)=>({blobId:a.blobId,type:a.type||"application/octet-stream",name:a.name,disposition:"attachment"}));

 const submission:any={identityId:identity.id,"#emailId":{resultOf:"e",name:"Email/set",path:"/created/draft/id"}};
 const calls:any[]=[
  ["Email/set",{accountId,create:{draft:email}},"e"],
  ["EmailSubmission/set",{accountId,create:{send:submission}},"s"]
 ];
 const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:calls};
 const r=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(body),cache:"no-store"});
 const d=await r.json();
 const created=d.methodResponses?.find((x:any)=>x[0]==="Email/set");
 const submissionResult=d.methodResponses?.find((x:any)=>x[0]==="EmailSubmission/set");
 const emailError=created?.[1]?.notCreated?.draft;
 const sendError=submissionResult?.[1]?.notCreated?.send;
 if(emailError||sendError||!submissionResult){
  console.error("JMAP send failed",JSON.stringify(d));
  return NextResponse.json({error:sendError?.description||emailError?.description||"Не удалось отправить письмо",type:sendError?.type||emailError?.type||"jmapError"},{status:400});
 }
 const emailId=created?.[1]?.created?.draft?.id;
 if(emailId&&sent){
  const patch:any={"keywords/$draft":null};
  patch["mailboxIds/"+drafts]=null;patch["mailboxIds/"+sent]=true;
  await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId,update:{[emailId]:patch}},"move"]]}),cache:"no-store"});
 }
 return NextResponse.json({ok:true});
}