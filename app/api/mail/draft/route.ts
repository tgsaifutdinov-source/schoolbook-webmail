import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";
async function ctx(){
 const token=(await getMailSession())?.token;if(!token)return null;
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});if(!sr.ok)return null;
 const s=await sr.json();const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];const u=new URL(s.apiUrl);
 const endpoint="http://host.docker.internal:18080"+u.pathname+u.search;
 const mr=await fetch(endpoint,{method:"POST",headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail","urn:ietf:params:jmap:submission"],methodCalls:[["Identity/get",{accountId},"i"],["Mailbox/get",{accountId,properties:["id","role"]},"m"]]}),cache:"no-store"});
 const md=await mr.json();return {headers,accountId,endpoint,identity:md.methodResponses?.find((x:any)=>x[0]==="Identity/get")?.[1]?.list?.[0],drafts:md.methodResponses?.find((x:any)=>x[0]==="Mailbox/get")?.[1]?.list?.find((x:any)=>x.role==="drafts")?.id};
}
const addresses=(v:string)=>String(v||"").split(/[;,\n]+/).map(x=>x.trim()).filter(Boolean).map(email=>({email}));const valid=(email:string)=>/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
export async function POST(req:NextRequest){
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {id,to="",cc="",bcc="",subject="",text="",attachments=[]}=await req.json();
 if(!c.identity||!c.drafts)return NextResponse.json({error:"Не найдена папка Черновики"},{status:400});
 const allRecipients=[...addresses(to),...addresses(cc),...addresses(bcc)];if(allRecipients.some((x:any)=>!valid(x.email)))return NextResponse.json({error:"Проверьте адреса получателей"},{status:400});
 const email:any={mailboxIds:{[c.drafts]:true},keywords:{"$draft":true},from:[{name:c.identity.name||"",email:c.identity.email}],to:addresses(to),cc:addresses(cc),bcc:addresses(bcc),subject,bodyValues:{body:{value:text,isTruncated:false}},textBody:[{partId:"body",type:"text/plain"}]};
 if(attachments.length)email.attachments=attachments.map((a:any)=>({blobId:a.blobId,type:a.type||"application/octet-stream",name:a.name,disposition:"attachment"}));
 const args:any={accountId:c.accountId};if(id)args.update={[id]:email};else args.create={draft:email};
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",args,"d"]]}),cache:"no-store"});const d=await r.json();const x=d.methodResponses?.[0];
 const err=id?x?.[1]?.notUpdated?.[id]:x?.[1]?.notCreated?.draft;if(x?.[0]==="error"||err)return NextResponse.json({error:err?.description||x?.[1]?.description||"Не удалось сохранить черновик"},{status:400});
 return NextResponse.json({ok:true,id:id||x?.[1]?.created?.draft?.id});
}
export async function DELETE(req:NextRequest){
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});const id=req.nextUrl.searchParams.get("id");if(!id)return NextResponse.json({error:"Missing id"},{status:400});
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId:c.accountId,destroy:[id]},"d"]]}),cache:"no-store"});const d=await r.json();if(d.methodResponses?.[0]?.[1]?.notDestroyed?.[id])return NextResponse.json({error:"Не удалось удалить черновик"},{status:400});return NextResponse.json({ok:true});
}