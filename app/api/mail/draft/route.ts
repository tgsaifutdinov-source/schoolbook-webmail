import {getMailSession} from "../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../lib/security";
import {buildJmapEmail} from "../../../../lib/jmap-email";
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
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await req.json().catch(()=>({}));const id=String(body.id||""),to=String(body.to||""),cc=String(body.cc||""),bcc=String(body.bcc||""),subject=String(body.subject||""),text=String(body.text||""),attachments=Array.isArray(body.attachments)?body.attachments.slice(0,100):[];
 if(subject.length>998||text.length>5_000_000)return NextResponse.json({error:"Черновик слишком большой"},{status:413});
 if(!c.identity||!c.drafts)return NextResponse.json({error:"Не найдена папка Черновики"},{status:400});
 const allRecipients=[...addresses(to),...addresses(cc),...addresses(bcc)];if(allRecipients.some((x:any)=>!valid(x.email)))return NextResponse.json({error:"Проверьте адреса получателей"},{status:400});if(allRecipients.length>200)return NextResponse.json({error:"Слишком много получателей в одном письме"},{status:400});
 const email=buildJmapEmail({drafts:c.drafts,identity:c.identity,to,cc,bcc,subject,text,attachments,includeFrom:false});
 // Email bodyStructure/bodyValues are immutable in JMAP. Saving an existing draft
 // therefore creates a replacement message and removes the previous draft.
 const args:any={accountId:c.accountId,create:{draft:email}};if(id)args.destroy=[id];
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",args,"d"]]}),cache:"no-store"});
 const result=await r.json();const x=result.methodResponses?.[0];
 const createErr=x?.[1]?.notCreated?.draft;
 if(x?.[0]==="error"||createErr){console.error("JMAP draft Email/set failed",JSON.stringify(result));return NextResponse.json({error:createErr?.description||x?.[1]?.description||"Не удалось сохранить черновик",type:createErr?.type||x?.[1]?.type||"jmapError",properties:createErr?.properties||x?.[1]?.properties||[]},{status:400})}
 const newId=x?.[1]?.created?.draft?.id;
 if(!newId){console.error("JMAP draft Email/set returned no id",JSON.stringify(result));return NextResponse.json({error:"Не удалось получить id сохранённого черновика"},{status:502})}
 const destroyErr=id?x?.[1]?.notDestroyed?.[id]:null;
 if(destroyErr)console.warn("JMAP old draft cleanup failed",JSON.stringify(destroyErr));
 return NextResponse.json({ok:true,id:newId,replacedId:id||null,cleanupWarning:!!destroyErr});
}
export async function DELETE(req:NextRequest){
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});const id=req.nextUrl.searchParams.get("id");if(!id)return NextResponse.json({error:"Missing id"},{status:400});
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/set",{accountId:c.accountId,destroy:[id]},"d"]]}),cache:"no-store"});const d=await r.json();if(d.methodResponses?.[0]?.[1]?.notDestroyed?.[id])return NextResponse.json({error:"Не удалось удалить черновик"},{status:400});return NextResponse.json({ok:true});
}