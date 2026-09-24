import {getMailSession} from "../../../../lib/mail-session";
import {sameOriginGuard} from "../../../../lib/security";
import {NextRequest,NextResponse} from "next/server";

function safeFilename(value:string){
 const cleaned=String(value||"attachment").replace(/[\\/\r\n\0"]/g,"_").trim().slice(0,180)||"attachment";
 const ascii=cleaned.replace(/[^\x20-\x7e]/g,"_").replace(/["\\]/g,"_")||"attachment";
 const encoded=encodeURIComponent(cleaned).replace(/['()*]/g,ch=>"%"+ch.charCodeAt(0).toString(16).toUpperCase());
 return {cleaned,ascii,encoded};
}
function safeMime(value:string){
 const v=String(value||"").trim();
 return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+*-]+$/i.test(v)?v:"application/octet-stream";
}
async function ctx(){
 const token=(await getMailSession())?.token;if(!token)return null;
 const auth={Authorization:"Basic "+token};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers:auth,cache:"no-store"});
 if(!sr.ok)return null;
 const s=await sr.json(),accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];
 return {token,s,accountId};
}
export async function GET(req:NextRequest){
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const blobId=req.nextUrl.searchParams.get("blobId");
 const file=safeFilename(req.nextUrl.searchParams.get("name")||"attachment"),name=file.cleaned;
 const requestedType=safeMime(req.nextUrl.searchParams.get("type")||"application/octet-stream");
 const inline=req.nextUrl.searchParams.get("inline")==="1";
 if(!blobId||blobId.length>2048||/[\r\n\0]/.test(blobId))return NextResponse.json({error:"Invalid blobId"},{status:400});
 const raw=String(c.s.downloadUrl).replace("{accountId}",encodeURIComponent(String(c.accountId))).replace("{blobId}",encodeURIComponent(blobId)).replace("{name}",encodeURIComponent(name)).replace("{type}",encodeURIComponent(requestedType));
 const u=new URL(raw),target="http://host.docker.internal:18080"+u.pathname+u.search;
 const r=await fetch(target,{headers:{Authorization:"Basic "+c.token},cache:"no-store"});
 if(!r.ok)return NextResponse.json({error:"Download failed"},{status:r.status});
 const upstream=safeMime(r.headers.get("content-type")||requestedType),safeInline=inline&&/^image\/(png|jpeg|gif|webp)$/i.test(upstream),type=safeInline?upstream:"application/octet-stream";
 const disposition=(safeInline?"inline":"attachment")+'; filename="'+file.ascii+'"; filename*=UTF-8\'\''+file.encoded;
 return new NextResponse(r.body,{status:200,headers:{
  "content-type":type,
  "content-disposition":disposition,
  "x-content-type-options":"nosniff",
  "x-download-options":"noopen",
  "cross-origin-resource-policy":"same-origin",
  "referrer-policy":"no-referrer",
  "cache-control":"private, no-store",
  "content-security-policy":"default-src 'none'; sandbox"
 }});
}
export async function POST(req:NextRequest){
 const blocked=sameOriginGuard(req);if(blocked)return blocked;
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const form=await req.formData(),file=form.get("file");
 if(!(file instanceof File))return NextResponse.json({error:"Missing file"},{status:400});
 if(file.size>100*1024*1024)return NextResponse.json({error:"Файл превышает 100 МБ"},{status:413});
 const raw=String(c.s.uploadUrl).replace("{accountId}",encodeURIComponent(String(c.accountId))),u=new URL(raw),target="http://host.docker.internal:18080"+u.pathname+u.search;
 const r=await fetch(target,{method:"POST",headers:{Authorization:"Basic "+c.token,"content-type":safeMime(file.type||"application/octet-stream")},body:Buffer.from(await file.arrayBuffer()),cache:"no-store"});
 if(!r.ok)return NextResponse.json({error:"Upload failed"},{status:r.status});
 const d=await r.json();
 return NextResponse.json({blobId:d.blobId,type:safeMime(d.type||file.type||"application/octet-stream"),size:d.size||file.size,name:file.name});
}
