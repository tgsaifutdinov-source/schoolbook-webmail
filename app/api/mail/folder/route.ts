import {cookies} from "next/headers";
import {NextRequest,NextResponse} from "next/server";
async function context(){
 const token=(await cookies()).get("sbmail_auth")?.value;if(!token)return null;
 const headers={Authorization:"Basic "+token,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers,cache:"no-store"});if(!sr.ok)return null;
 const s=await sr.json();const accountId=s.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(s.accounts||{})[0];const u=new URL(s.apiUrl);
 return {headers,accountId,endpoint:"http://host.docker.internal:18080"+u.pathname+u.search};
}
export async function POST(req:NextRequest){
 const c=await context();if(!c)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {action,id,name}=await req.json();if(!action)return NextResponse.json({error:"Missing action"},{status:400});
 let args:any={accountId:c.accountId};
 if(action==="create"){if(!name?.trim())return NextResponse.json({error:"Укажите название папки"},{status:400});args.create={folder:{name:name.trim()}}}
 else if(action==="rename"){if(!id||!name?.trim())return NextResponse.json({error:"Missing folder data"},{status:400});args.update={[id]:{name:name.trim()}}}
 else if(action==="delete"){if(!id)return NextResponse.json({error:"Missing folder id"},{status:400});args.destroy=[id]}
 else return NextResponse.json({error:"Unknown action"},{status:400});
 const body={using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Mailbox/set",args,"m"]]};
 const r=await fetch(c.endpoint,{method:"POST",headers:c.headers,body:JSON.stringify(body),cache:"no-store"});const d=await r.json();const x=d.methodResponses?.[0];
 const failed=x?.[0]==="error"||Object.keys(x?.[1]?.notCreated||{}).length||Object.keys(x?.[1]?.notUpdated||{}).length||Object.keys(x?.[1]?.notDestroyed||{}).length;
 if(failed)return NextResponse.json({error:x?.[1]?.description||"Не удалось изменить папку",details:x?.[1]},{status:400});
 return NextResponse.json({ok:true,created:x?.[1]?.created?.folder||null});
}