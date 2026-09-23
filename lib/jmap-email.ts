type Address={name?:string;email:string};
type Identity={name?:string;email:string};
type Attachment={blobId:string;type?:string;name?:string;size?:number};

function addresses(value:string):Address[]{
 return String(value||"").split(/[;,\n]+/).map(v=>v.trim()).filter(Boolean).map(email=>({email}));
}
function attachmentPart(a:Attachment,index:number){
 return {
  partId:"attachment-"+(index+1),
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
 attachments?:Attachment[];
 includeFrom?:boolean;
}){
 const to=addresses(input.to||""),cc=addresses(input.cc||""),bcc=addresses(input.bcc||"");
 const attachments=(input.attachments||[]).filter(a=>a&&typeof a.blobId==="string"&&a.blobId).slice(0,100);
 const textPart={partId:"body",type:"text/plain",charset:"utf-8"};
 const bodyStructure:any=attachments.length
  ?{type:"multipart/mixed",subParts:[textPart,...attachments.map(attachmentPart)]}
  :textPart;
 const from=input.identity.name
  ?[{name:String(input.identity.name),email:String(input.identity.email)}]
  :[{email:String(input.identity.email)}];
 const email:any={
  mailboxIds:{[input.drafts]:true},
  keywords:{"$draft":true},
  subject:String(input.subject||""),
  bodyStructure,
  bodyValues:{body:{value:String(input.text||""),isTruncated:false}}
 };
 if(input.includeFrom)email.from=from;
 if(to.length)email.to=to;
 if(cc.length)email.cc=cc;
 if(bcc.length)email.bcc=bcc;
 return email;
}
