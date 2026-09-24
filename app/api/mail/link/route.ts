import {getMailSession} from "../../../../lib/mail-session";
import {NextRequest,NextResponse} from "next/server";

export const dynamic="force-dynamic";

function esc(value:string){
 return String(value||"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));
}
function hostOf(value:string){
 try{return new URL(value).hostname.toLowerCase().replace(/^www\./,"")}catch{return ""}
}
function visibleHost(text:string){
 const value=String(text||"").trim();
 if(!value||/\s/.test(value)||value.length>220)return "";
 try{
  const candidate=/^https?:\/\//i.test(value)?value:"https://"+value;
  const u=new URL(candidate);
  if(!u.hostname.includes("."))return "";
  return u.hostname.toLowerCase().replace(/^www\./,"");
 }catch{return ""}
}
function sameDisplayedHost(displayed:string,actual:string){
 if(!displayed||!actual)return true;
 return displayed===actual||displayed.endsWith("."+actual)||actual.endsWith("."+displayed);
}

export async function GET(req:NextRequest){
 const token=(await getMailSession())?.token;
 if(!token)return NextResponse.json({error:"Unauthorized"},{status:401});
 const raw=(req.nextUrl.searchParams.get("url")||"").trim(),text=(req.nextUrl.searchParams.get("text")||"").trim().slice(0,220);
 let target:URL;
 try{target=new URL(raw)}catch{return NextResponse.json({error:"Invalid link"},{status:400})}
 if(target.protocol!=="https:"&&target.protocol!=="http:")return NextResponse.json({error:"Unsupported link protocol"},{status:400});
 const actual=hostOf(target.toString()),shown=visibleHost(text),mismatch=!!shown&&!sameDisplayedHost(shown,actual),insecure=target.protocol==="http:",ip=/^(?:\d{1,3}\.){3}\d{1,3}$|^\[[0-9a-f:]+\]$/i.test(actual);
 const warnings=[
  mismatch?"Текст ссылки указывает на "+shown+", а фактический адрес ведёт на "+actual+".":"",
  insecure?"Соединение использует HTTP без шифрования.":"",
  ip?"Адрес назначения указан напрямую как IP-адрес.":""
 ].filter(Boolean);
 const warningHtml=warnings.map(w=>'<div class="warn">'+esc(w)+'</div>').join("");
 const body='<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Проверка ссылки · SchoolBook Mail</title><style>'+
 '*{box-sizing:border-box}body{margin:0;background:#f6f8fc;color:#202124;font:14px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(620px,100%);background:#fff;border:1px solid #e3e6ea;border-radius:16px;box-shadow:0 10px 32px rgba(60,64,67,.15);overflow:hidden}.head{padding:22px 24px 14px;border-bottom:1px solid #edf0f2}.brand{font-weight:700}.brand i{font-style:normal;color:#b88700}.body{padding:22px 24px}.eyebrow{color:#5f6368;font-size:12px}.host{margin:7px 0 15px;padding:12px 14px;border-radius:10px;background:#f1f3f4;font:600 15px ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.dest{margin:0 0 16px;color:#5f6368;overflow-wrap:anywhere}.warn{margin:10px 0;padding:11px 13px;border:1px solid #efd27a;border-radius:10px;background:#fff8df;color:#5c4700}.foot{padding:14px 24px 22px;display:flex;align-items:center;justify-content:flex-end;gap:8px}.continue{display:inline-flex;align-items:center;height:38px;padding:0 16px;border-radius:19px;background:#ffc62b;color:#332900;text-decoration:none;font-weight:700}.hint{margin-right:auto;color:#80868b;font-size:11px}@media(max-width:560px){.wrap{padding:10px}.head,.body,.foot{padding-left:16px;padding-right:16px}.foot{align-items:flex-start;flex-direction:column}.continue{width:100%;justify-content:center}.hint{margin:0}}</style></head><body><main class="wrap"><section class="card"><div class="head"><div class="brand">SchoolBook <i>Mail</i></div></div><div class="body"><div class="eyebrow">Вы переходите на внешний сайт</div><div class="host">'+esc(actual||target.host)+'</div><p class="dest">'+esc(target.toString())+'</p>'+warningHtml+'</div><div class="foot"><span class="hint">Продолжайте только если узнаёте этот адрес.</span><a class="continue" href="'+esc(target.toString())+'" rel="noopener noreferrer nofollow" referrerpolicy="no-referrer">Продолжить</a></div></section></main></body></html>';
 return new NextResponse(body,{status:200,headers:{"content-type":"text/html; charset=utf-8","cache-control":"private, no-store","referrer-policy":"no-referrer","x-frame-options":"DENY","x-content-type-options":"nosniff","cross-origin-opener-policy":"same-origin","content-security-policy":"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}}); 
}
