import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";
import {deflateRawSync} from "zlib";

const MAX_FILES=50;
const MAX_TOTAL_BYTES=50*1024*1024;
const CRC_TABLE=(()=>{const table=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;table[n]=c>>>0}return table})();
function crc32(buf:Buffer){let c=0xffffffff;for(const b of buf)c=CRC_TABLE[(c^b)&0xff]^(c>>>8);return (c^0xffffffff)>>>0}
function safeName(value:string,fallback="attachment"){const cleaned=String(value||fallback).replace(/[\\/\r\n\0"]/g,"_").trim().slice(0,160);return cleaned||fallback}
function uniqueName(value:string,used:Set<string>){let name=safeName(value),candidate=name,n=2;const dot=name.lastIndexOf("."),base=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):"";while(used.has(candidate.toLowerCase()))candidate=base+" ("+(n++)+")"+ext;used.add(candidate.toLowerCase());return candidate}
function dosDateTime(date=new Date()){const year=Math.max(1980,date.getFullYear()),time=((date.getHours()&31)<<11)|((date.getMinutes()&63)<<5)|((Math.floor(date.getSeconds()/2))&31),day=((year-1980)<<9)|(((date.getMonth()+1)&15)<<5)|(date.getDate()&31);return {time,date:day}}
function makeZip(files:{name:string,data:Buffer}[]){const locals:Buffer[]=[],centrals:Buffer[]=[];let offset=0,centralSize=0;const stamp=dosDateTime();for(const file of files){const name=Buffer.from(file.name,"utf8"),raw=file.data,compressed=deflateRawSync(raw,{level:6}),crc=crc32(raw),local=Buffer.alloc(30),central=Buffer.alloc(46);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);local.writeUInt16LE(0x0800,6);local.writeUInt16LE(8,8);local.writeUInt16LE(stamp.time,10);local.writeUInt16LE(stamp.date,12);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);local.writeUInt32LE(raw.length,22);local.writeUInt16LE(name.length,26);local.writeUInt16LE(0,28);locals.push(local,name,compressed);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);central.writeUInt16LE(20,6);central.writeUInt16LE(0x0800,8);central.writeUInt16LE(8,10);central.writeUInt16LE(stamp.time,12);central.writeUInt16LE(stamp.date,14);central.writeUInt32LE(crc,16);central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);central.writeUInt16LE(name.length,28);central.writeUInt16LE(0,30);central.writeUInt16LE(0,32);central.writeUInt16LE(0,34);central.writeUInt16LE(0,36);central.writeUInt32LE(0,38);central.writeUInt32LE(offset,42);centrals.push(central,name);offset+=local.length+name.length+compressed.length;centralSize+=central.length+name.length}const end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(0,4);end.writeUInt16LE(0,6);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(centralSize,12);end.writeUInt32LE(offset,16);end.writeUInt16LE(0,20);return Buffer.concat([...locals,...centrals,end])}

export async function GET(req:NextRequest){
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const id=req.nextUrl.searchParams.get("id");
 if(!id)return NextResponse.json({error:"Missing id"},{status:400});
 const auth={Authorization:"Basic "+token},headers={...auth,"content-type":"application/json"};
 const sr=await fetch("http://host.docker.internal:18080/jmap/session",{headers:auth,cache:"no-store"});
 if(!sr.ok)return NextResponse.json({error:"Unauthorized"},{status:401});
 const session=await sr.json(),accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
 if(!accountId)return NextResponse.json({error:"Mail account not found"},{status:404});
 const api=new URL(session.apiUrl),endpoint="http://host.docker.internal:18080"+api.pathname+api.search;
 const er=await fetch(endpoint,{method:"POST",headers,cache:"no-store",body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls:[["Email/get",{accountId,ids:[id],properties:["id","subject","attachments"]},"e"]]})});
 if(!er.ok)return NextResponse.json({error:"JMAP request failed"},{status:er.status});
 const ed=await er.json(),mail=(ed.methodResponses||[]).find((x:any)=>x[0]==="Email/get")?.[1]?.list?.[0];
 if(!mail)return NextResponse.json({error:"Message not found"},{status:404});
 const attachments=(Array.isArray(mail.attachments)?mail.attachments:[]).filter((a:any)=>a?.blobId&&String(a.disposition||"attachment").toLowerCase()!=="inline").slice(0,MAX_FILES);
 if(!attachments.length)return NextResponse.json({error:"No attachments"},{status:404});
 const declared=attachments.reduce((n:number,a:any)=>n+(Number(a.size)||0),0);
 if(declared>MAX_TOTAL_BYTES)return NextResponse.json({error:"Суммарный размер вложений превышает 50 МБ"},{status:413});
 const used=new Set<string>(),files:{name:string,data:Buffer}[]=[];let total=0;
 for(let i=0;i<attachments.length;i++){
  const a=attachments[i],name=uniqueName(a.name||("attachment-"+(i+1)),used),raw=String(session.downloadUrl).replace("{accountId}",encodeURIComponent(String(accountId))).replace("{blobId}",encodeURIComponent(String(a.blobId))).replace("{name}",encodeURIComponent(name)).replace("{type}",encodeURIComponent(String(a.type||"application/octet-stream"))),u=new URL(raw),target="http://host.docker.internal:18080"+u.pathname+u.search;
  const r=await fetch(target,{headers:auth,cache:"no-store"});
  if(!r.ok)return NextResponse.json({error:"Не удалось скачать "+name},{status:502});
  const data=Buffer.from(await r.arrayBuffer());total+=data.length;if(total>MAX_TOTAL_BYTES)return NextResponse.json({error:"Суммарный размер вложений превышает 50 МБ"},{status:413});files.push({name,data});
 }
 const zip=makeZip(files),base=safeName(String(mail.subject||"attachments"),"attachments").replace(/\.zip$/i,""),filename=(base||"attachments")+".zip";
 return new NextResponse(new Uint8Array(zip),{status:200,headers:{"content-type":"application/zip","content-disposition":'attachment; filename="'+filename+'"',"content-length":String(zip.length),"cache-control":"private, no-store","x-content-type-options":"nosniff"}});
}
