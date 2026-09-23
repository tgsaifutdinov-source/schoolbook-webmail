import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";
async function ctx(){
 const token=(await cookies()).get("sbmail_auth")?.value;if(!token)return null;
 const auth={Authorization:"Basic "+token};const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers:auth,cache:"no-store"});if(!sr.ok)return null;
 const s=await sr.json();const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];return {token,s,accountId};
}
export async function GET(req:NextRequest){
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const blobId=req.nextUrl.searchParams.get("blobId");const name=req.nextUrl.searchParams.get("name")||"attachment";const type=req.nextUrl.searchParams.get("type")||"application/octet-stream";
 if(!blobId)return NextResponse.json({error:"Missing blobId"},{status:400});
 const raw=String(c.s.downloadUrl).replace("{accountId}",encodeURIComponent(String(c.accountId))).replace("{blobId}",encodeURIComponent(blobId)).replace("{name}",encodeURIComponent(name)).replace("{type}",encodeURIComponent(type));
 const u=new URL(raw);const target="http://host.docker.internal:18080"+u.pathname+u.search;
 const r=await fetch(target,{headers:{Authorization:"Basic "+c.token},cache:"no-store"});if(!r.ok)return NextResponse.json({error:"Download failed"},{status:r.status});
 return new NextResponse(r.body,{status:200,headers:{"content-type":r.headers.get("content-type")||type,"content-disposition":'attachment; filename="'+name.replace(/"/g,"")+'"'}});
}
export async function POST(req:NextRequest){
 const c=await ctx();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const form=await req.formData();const file=form.get("file");if(!(file instanceof File))return NextResponse.json({error:"Missing file"},{status:400});
 const raw=String(c.s.uploadUrl).replace("{accountId}",encodeURIComponent(String(c.accountId)));const u=new URL(raw);const target="http://host.docker.internal:18080"+u.pathname+u.search;
 const r=await fetch(target,{method:"POST",headers:{Authorization:"Basic "+c.token,"content-type":file.type||"application/octet-stream"},body:Buffer.from(await file.arrayBuffer()),cache:"no-store"});
 if(!r.ok)return NextResponse.json({error:"Upload failed"},{status:r.status});const d=await r.json();return NextResponse.json({blobId:d.blobId,type:d.type||file.type||"application/octet-stream",size:d.size||file.size,name:file.name});
}