type Address={name?:string;email:string};
type Identity={name?:string;email:string};
type Attachment={blobId:string;type?:string;name?:string;size?:number};

function sanitizeComposerHtml(value:string){
 const allowed=new Set(["p","div","br","b","strong","i","em","u","ul","ol","li","blockquote","a"]);
 return String(value||"").replace(/<\/?[^>]+>/g,raw=>{
  const match=/^<\s*(\/)?\s*([a-z0-9]+)([^>]*)>/i.exec(raw);if(!match)return "";
  const closing=!!match[1],tag=match[2].toLowerCase();if(!allowed.has(tag))return "";
  if(closing)return tag==="br"?"":`</${tag}>`;
  if(tag==="br")return "<br>";
  if(tag==="div"&&/\bdata-sb-quote\s*=\s*(?:"1"|\'1\'|1)/i.test(match[3]||""))return `<div data-sb-quote="1">`;
  if(tag==="a"){
   const hrefMatch=/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(match[3]||"");
   const href=(hrefMatch?.[1]||hrefMatch?.[2]||hrefMatch?.[3]||"").trim();
   if(/^(https?:|mailto:)/i.test(href)){
    const safe=href.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    return `<a href="${safe}">`;
   }
   return "<a>";
  }
  return `<${tag}>`;
 });
}

function addresses(value:string):Address[]{
 return String(value||"").split(/[;,\n]+/).map(v=>v.trim()).filter(Boolean).map(email=>({email}));
}
function messageIds(values?:string[]){
 const seen=new Set<string>();
 return (Array.isArray(values)?values:[]).map(v=>String(v||"").trim()).filter(v=>v&&!/[\r\n]/.test(v)&&v.length<=998).filter(v=>{const key=v.toLowerCase();if(seen.has(key))return false;seen.add(key);return true}).slice(0,100);
}
function attachmentPart(a:Attachment,_index:number){
 return {
  blobId:String(a.blobId),
  type:String(a.type||"application/octet-stream"),
  name:String(a.name||"attachment").slice(0,255),
  disposition:"attachment"
 };
}
export function buildJmapEmail(input:{
 drafts:string;
 identity:Identity;
 to?:string;
 cc?:string;
 bcc?:string;
 subject?:string;
 text?:string;
 html?:string;
 attachments?:Attachment[];
 inReplyTo?:string[];
 references?:string[];
 includeFrom?:boolean;
}){
 const seen=new Set<string>();const unique=(items:Address[])=>items.filter(a=>{const key=a.email.toLowerCase();if(seen.has(key))return false;seen.add(key);return true});
 const to=unique(addresses(input.to||"")),cc=unique(addresses(input.cc||"")),bcc=unique(addresses(input.bcc||""));
 const attachments=(input.attachments||[]).filter(a=>a&&typeof a.blobId==="string"&&a.blobId).slice(0,100);
 const inReplyTo=messageIds(input.inReplyTo),references=messageIds(input.references);
 const html=sanitizeComposerHtml(input.html||"").trim();
 const textPart={partId:"text",type:"text/plain"};
 const htmlPart={partId:"html",type:"text/html"};
 const contentPart:any=html?{type:"multipart/alternative",subParts:[textPart,htmlPart]}:textPart;
 const bodyStructure:any=attachments.length
  ?{type:"multipart/mixed",subParts:[contentPart,...attachments.map(attachmentPart)]}
  :contentPart;
 const from=input.identity.name
  ?[{name:String(input.identity.name),email:String(input.identity.email)}]
  :[{email:String(input.identity.email)}];
 const email:any={
  mailboxIds:{[input.drafts]:true},
  keywords:{"$draft":true},
  subject:String(input.subject||""),
  bodyStructure,
  bodyValues:{
   text:{value:String(input.text||""),isTruncated:false},
   ...(html?{html:{value:html,isTruncated:false}}:{})
  }
 };
 if(input.includeFrom)email.from=from;
 if(inReplyTo.length)email.inReplyTo=inReplyTo;
 if(references.length)email.references=references;
 if(to.length)email.to=to;
 if(cc.length)email.cc=cc;
 if(bcc.length)email.bcc=bcc;
 return email;
}
