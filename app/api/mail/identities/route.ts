import {getMailSession} from "../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../lib/security";
import {NextRequest,NextResponse} from "next/server";

async function context(){
 const token=(await getMailSession())?.token;
 if(!token)return null;
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});
 if(!sr.ok)return null;
 const session=await sr.json();
 const accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
 if(!accountId)return null;
 const u=new URL(session.apiUrl);
 return {headers,accountId,endpoint:"http://host.docker.internal:18080"+u.pathname+u.search};
}
function cleanAddressList(value:any){
 return (Array.isArray(value)?value:[]).map((x:any)=>({name:String(x?.name||"").slice(0,200)||undefined,email:String(x?.email||"").trim()})).filter((x:any)=>x.email&&x.email.length<=320).slice(0,50);
}
function cleanIdentity(value:any){
 return {
  id:String(value?.id||""),
  name:String(value?.name||"").slice(0,200),
  email:String(value?.email||"").trim(),
  replyTo:cleanAddressList(value?.replyTo),
  bcc:cleanAddressList(value?.bcc),
  textSignature:String(value?.textSignature||"").slice(0,50_000),
  htmlSignature:String(value?.htmlSignature||"").slice(0,100_000),
  mayDelete:!!value?.mayDelete
 };
}

export async function GET(){
 const c=await context();
 if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,cache:"no-store",body:JSON.stringify({
  using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:submission"],
  methodCalls:[["Identity/get",{accountId:c.accountId,properties:["id","name","email","replyTo","bcc","textSignature","htmlSignature","mayDelete"]},"i"]]
 })});
 if(!r.ok)return NextResponse.json({error:"JMAP request failed"},{status:r.status});
 const d=await r.json(),x=(d.methodResponses||[]).find((item:any)=>item[0]==="Identity/get");
 if(!x)return NextResponse.json({error:"Не удалось загрузить адреса отправителя"},{status:502});
 return NextResponse.json({identities:(x[1]?.list||[]).map(cleanIdentity),state:String(x[1]?.state||"")});
}

export async function POST(req:NextRequest){
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const c=await context();
 if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await req.json().catch(()=>({})),id=String(body.id||"").trim();
 if(!id)return NextResponse.json({error:"Не указан отправитель"},{status:400});
 const textSignature=String(body.textSignature||""),htmlSignature=String(body.htmlSignature||"");
 if(textSignature.length>50_000||htmlSignature.length>100_000)return NextResponse.json({error:"Подпись слишком большая"},{status:413});
 const patch:any={textSignature,htmlSignature};
 if(typeof body.name==="string"){const name=body.name.trim();if(name.length>200)return NextResponse.json({error:"Имя слишком длинное"},{status:400});patch.name=name}
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,cache:"no-store",body:JSON.stringify({
  using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:submission"],
  methodCalls:[["Identity/set",{accountId:c.accountId,update:{[id]:patch}},"i"]]
 })});
 if(!r.ok)return NextResponse.json({error:"JMAP request failed"},{status:r.status});
 const d=await r.json(),x=(d.methodResponses||[]).find((item:any)=>item[0]==="Identity/set"),err=x?.[1]?.notUpdated?.[id];
 if(!x||err)return NextResponse.json({error:err?.description||"Не удалось сохранить подпись",type:err?.type||"jmapError"},{status:400});
 return NextResponse.json({ok:true,id});
}
