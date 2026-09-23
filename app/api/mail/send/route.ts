import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";
export async function POST(req:NextRequest){
 const token=(await cookies()).get("sbmail_auth")?.value;if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {to,subject,text}=await req.json();if(!to?.trim()||!text?.trim())return NextResponse.json({error:"Укажите получателя и текст"},{status:400});
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const s=await sr.json();const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];const u=new URL(s.apiUrl);const endpoint="http://host.docker.internal:18080"+u.pathname+u.search;
 const recipients=String(to).split(",").map((x:string)=>x.trim()).filter(Boolean).map((email:string)=>({email}));
 const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[
  ["Identity/get",{accountId},"i"],
  ["Email/set",{accountId,create:{"draft":{"mailboxIds":{},"keywords":{"$draft":true},"to":recipients,"subject":subject||"","bodyValues":{"body":{"value":text,"isTruncated":false}},"textBody":[{"partId":"body","type":"text/plain"}]}}},"e"],
  ["EmailSubmission/set",{accountId,create:{"send":{"identityId":"#identity","emailId":"#email"}}},"s"]
 ]};
 // Resolve identity/email creation references after fetching the default identity.
 const ir=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[["Identity/get",{accountId},"i"]]}),cache:"no-store"});
 const idata=await ir.json();const identity=idata.methodResponses?.find((x:any)=>x[0]==="Identity/get")?.[1]?.list?.[0];
 if(!identity)return NextResponse.json({error:"Не найдена почтовая идентичность"},{status:400});
 const sendBody={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[
  ["Email/set",{accountId,create:{"draft":{"mailboxIds":{},"keywords":{"$draft":true},"from":[{name:identity.name||"",email:identity.email}],"to":recipients,"subject":subject||"","bodyValues":{"body":{"value":text,"isTruncated":false}},"textBody":[{"partId":"body","type":"text/plain"}]}}},"e"],
  ["EmailSubmission/set",{accountId,create:{"send":{"identityId":identity.id,"emailId":"#draft"}}},"s"]
 ]};
 const r=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify(sendBody),cache:"no-store"});const d=await r.json();
 const submission=d.methodResponses?.find((x:any)=>x[0]==="EmailSubmission/set");
 if(!submission||submission[1]?.notCreated?.send)return NextResponse.json({error:"Не удалось отправить письмо",details:submission?.[1]?.notCreated?.send||d},{status:400});
 return NextResponse.json({ok:true});
}