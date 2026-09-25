#!/usr/bin/env node
import {randomUUID} from "node:crypto";

const JMAP_URL=process.env.JMAP_URL||"http://127.0.0.1:18080/jmap/session";
const USER=process.env.JMAP_USER||"";
const PASSWORD=process.env.JMAP_PASSWORD||"";
const DRY_RUN=process.argv.includes("--dry-run");
const PRETTY_ONLY=process.argv.includes("--pretty-20");
const CRLF="\r\n";

if(!USER||(!PASSWORD&&!DRY_RUN)){
  console.error("Usage: JMAP_USER=album@schoolbook.kg JMAP_PASSWORD='password' npm run seed:test-mail");
  console.error("Optional: JMAP_URL=http://127.0.0.1:18080/jmap/session");
  console.error("Preview without connecting: JMAP_USER=album@schoolbook.kg npm run seed:test-mail -- --dry-run");
  process.exit(1);
}

const auth="Basic "+Buffer.from(USER+":"+PASSWORD).toString("base64");
const runTag=new Date().toISOString().replace(/\D/g,"").slice(0,14);
const tinyPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z1N8AAAAASUVORK5CYII=","base64");
const pdf=Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 180]/Contents 4 0 R>>endobj\n4 0 obj<</Length 54>>stream\nBT /F1 18 Tf 30 100 Td (SchoolBook QA PDF attachment) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \ntrailer<</Root 1 0 R/Size 5>>\nstartxref\n0\n%%EOF\n");
const fakeZip=Buffer.from("PK\u0003\u0004SchoolBook QA harmless archive placeholder\nREADME: attachment renderer test only.\n");
const csv=Buffer.from("name,email,status\nTimur,timur@example.com,paid\nAida,aida@example.com,pending\n","utf8");
const json=Buffer.from(JSON.stringify({project:"SchoolBook",kind:"QA attachment",items:[1,2,3],ok:true},null,2),"utf8");
const ics=Buffer.from("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//SchoolBook QA//Mail Test//RU\r\nBEGIN:VEVENT\r\nUID:qa-event@schoolbook.test\r\nDTSTAMP:20260925T010000Z\r\nDTSTART:20261001T090000Z\r\nDTEND:20261001T100000Z\r\nSUMMARY:SchoolBook QA meeting\r\nLOCATION:Studio 1\r\nDESCRIPTION:Calendar attachment rendering test\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n","utf8");
const vcf=Buffer.from("BEGIN:VCARD\r\nVERSION:3.0\r\nFN:SchoolBook QA Contact\r\nEMAIL:qa-contact@schoolbook.test\r\nTEL:+996555123456\r\nORG:SchoolBook\r\nEND:VCARD\r\n","utf8");

function b64(value){
  const buf=Buffer.isBuffer(value)?value:Buffer.from(String(value),"utf8");
  return buf.toString("base64").replace(/.{1,76}/g,"$&\r\n").trimEnd();
}
function encoded(value){return "=?UTF-8?B?"+Buffer.from(String(value),"utf8").toString("base64")+"?="}
function esc(value){return String(value).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function boundary(prefix){return "sb_"+prefix+"_"+randomUUID().replace(/-/g,"")}
function textPart(text){
  return [
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(text)
  ].join(CRLF);
}
function htmlPart(html){
  return [
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    b64(html)
  ].join(CRLF);
}
function alternative(text,html){
  const b=boundary("alt");
  return {
    headers:['Content-Type: multipart/alternative; boundary="'+b+'"'],
    body:["--"+b,textPart(text),"--"+b,htmlPart(html),"--"+b+"--"].join(CRLF)
  };
}
function related(text,html){
  const rel=boundary("rel"),alt=alternative(text,html);
  const image=[
    'Content-Type: image/png; name="schoolbook-inline.png"',
    "Content-Transfer-Encoding: base64",
    "Content-ID: <schoolbook-inline@qa>",
    'Content-Disposition: inline; filename="schoolbook-inline.png"',
    "",
    b64(tinyPng)
  ].join(CRLF);
  return {
    headers:['Content-Type: multipart/related; boundary="'+rel+'"'],
    body:["--"+rel,...alt.headers,"",alt.body,"--"+rel,image,"--"+rel+"--"].join(CRLF)
  };
}
function attachmentPart(a){
  return [
    'Content-Type: '+a.type+'; name="'+a.name.replace(/"/g,"")+'"',
    "Content-Transfer-Encoding: base64",
    'Content-Disposition: attachment; filename="'+a.name.replace(/"/g,"")+'"',
    "",
    b64(a.data)
  ].join(CRLF);
}
function buildMime(item,index){
  const msgId="<qa-"+runTag+"-"+String(index+1).padStart(2,"0")+"@schoolbook.test>";
  const date=new Date(Date.now()-(30-index)*7*60*1000);
  const fromName=item.fromName||"SchoolBook QA";
  const fromEmail=item.fromEmail||("qa"+String(index+1).padStart(2,"0")+"@schoolbook.test");
  const headers=[
    "From: "+encoded(fromName)+" <"+fromEmail+">",
    "To: <"+USER+">",
    ...(item.cc?["Cc: "+item.cc]:[]),
    "Subject: "+encoded("["+(PRETTY_ONLY?"HTML":"QA")+" "+String(index+1).padStart(2,"0")+"/"+expectedCount+"] "+item.subject),
    "Date: "+date.toUTCString(),
    "Message-ID: "+msgId,
    ...(item.inReplyTo?["In-Reply-To: "+item.inReplyTo,"References: "+item.references]:[]),
    "MIME-Version: 1.0",
    "X-SchoolBook-QA: "+String(index+1).padStart(2,"0"),
    "X-SchoolBook-QA-Scenario: "+item.key
  ];

  let entity;
  if(item.plainOnly){
    entity={headers:['Content-Type: text/plain; charset="UTF-8"',"Content-Transfer-Encoding: base64"],body:b64(item.text)};
  }else if(item.htmlOnly){
    entity={headers:['Content-Type: text/html; charset="UTF-8"',"Content-Transfer-Encoding: base64"],body:b64(item.html)};
  }else{
    entity=item.inlineCid?related(item.text,item.html):alternative(item.text,item.html);
  }

  if(item.attachments?.length){
    const mix=boundary("mix");
    return [
      ...headers,
      'Content-Type: multipart/mixed; boundary="'+mix+'"',
      "",
      "--"+mix,
      ...entity.headers,
      "",
      entity.body,
      ...item.attachments.flatMap(a=>["--"+mix,attachmentPart(a)]),
      "--"+mix+"--",
      ""
    ].join(CRLF);
  }
  return [...headers,...entity.headers,"",entity.body,""].join(CRLF);
}
function shell(title,body,opts={}){
  const accent=opts.accent||"#f4c542";
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>'+
    'body{margin:0;background:#f6f7f9;font-family:Arial,sans-serif;color:#202124}.wrap{max-width:680px;margin:0 auto;background:#fff}.pad{padding:28px}.h{font-size:24px;line-height:1.25;margin:0 0 16px}.p{font-size:15px;line-height:1.6;margin:0 0 14px}.btn{display:inline-block;background:'+accent+';color:#2d2600!important;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700}.muted{color:#6f7782;font-size:12px;line-height:1.5}.card{border:1px solid #e3e7ec;border-radius:12px;padding:18px;margin:14px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:560px){.pad{padding:18px}.grid{grid-template-columns:1fr}.h{font-size:20px}}'+
    '</style></head><body><div class="wrap"><div style="height:5px;background:'+accent+'"></div><div class="pad"><h1 class="h">'+esc(title)+'</h1>'+body+'</div></div></body></html>';
}
const remoteHero=(seed,text="SchoolBook QA")=>'<img src="https://picsum.photos/seed/'+encodeURIComponent(seed)+'/1200/520" width="680" style="display:block;width:100%;max-width:680px;height:auto" alt="'+esc(text)+'">';
const card=(title,text)=>'<div class="card"><b>'+esc(title)+'</b><p class="p" style="margin-top:8px">'+esc(text)+'</p></div>';

const baseScenarios=[
 {key:"plain-short",subject:"Короткое plain-text письмо",plainOnly:true,text:"Привет!\n\nЭто короткое текстовое письмо без HTML.\nПроверяем переносы строк, кириллицу и обычную ссылку: https://schoolbook.kg/test?q=mail\n\nSchoolBook QA"},
 {key:"html-typography",subject:"Типографика: заголовки, списки, цитата",text:"HTML typography test",html:shell("Типографика письма",'<p class="p">Обычный <b>жирный</b>, <i>курсив</i>, <u>подчёркнутый</u> и <a href="https://schoolbook.kg">ссылка</a>.</p><h2>Подзаголовок</h2><ul><li>Первый пункт</li><li>Второй пункт</li></ul><blockquote style="margin:18px 0;border-left:3px solid #f4c542;padding-left:14px;color:#5f6368">Цитата для проверки вложенных отступов.</blockquote>')},
 {key:"newsletter-hero",subject:"Newsletter с большой внешней картинкой",text:"Newsletter with remote hero image",html:shell("SchoolBook Digest",remoteHero("schoolbook-news","Большой баннер")+'<p class="p">Проверяем блокировку внешних изображений, широкую картинку и CTA.</p><a class="btn" href="https://schoolbook.kg">Открыть SchoolBook</a>')},
 {key:"invoice-table",subject:"Счёт № SB-2026-0042 с таблицей",text:"Invoice SB-2026-0042 total 12 450 сом",html:shell("Счёт оплачен",'<table role="presentation" width="100%" cellpadding="10" cellspacing="0" style="border-collapse:collapse;border:1px solid #e3e7ec"><tr style="background:#f7f8fa"><th align="left">Позиция</th><th align="right">Кол-во</th><th align="right">Сумма</th></tr><tr><td>Выпускной альбом</td><td align="right">1</td><td align="right">12 000 сом</td></tr><tr><td>Доставка</td><td align="right">1</td><td align="right">450 сом</td></tr><tr><td colspan="2"><b>Итого</b></td><td align="right"><b>12 450 сом</b></td></tr></table>')},
 {key:"order-timeline",subject:"Статус заказа — длинная вертикальная структура",text:"Order timeline",html:shell("Заказ #SB-4281",'<div style="border-left:3px solid #f4c542;padding-left:18px">'+Array.from({length:7},(_,i)=>'<p class="p"><b>Этап '+(i+1)+'</b><br><span class="muted">Подробное описание статуса заказа и служебная информация.</span></p>').join("")+'</div>')},
 {key:"verification-code",subject:"Код подтверждения 064081",text:"Your verification code is 064081",html:shell("Код подтверждения",'<p class="p">Используйте код:</p><div style="display:flex;gap:6px;margin:18px 0">'+[0,6,4,0,8,1].map(n=>'<span style="display:inline-block;background:#f1f3f4;border-radius:6px;padding:10px 12px;font:700 22px monospace">'+n+'</span>').join("")+'</div><a class="btn" href="https://schoolbook.kg">Скопировать код</a>')},
 {key:"marketing-cards",subject:"Карточки услуг в две колонки",text:"Marketing cards",html:shell("Новые возможности",'<div class="grid">'+card("Онлайн-отбор","Выберите фотографии вместе с клиентом.")+card("Статусы","Отслеживайте производство заказа.")+card("Уведомления","Автоматические сообщения клиентам.")+card("Архив","История заказов в одном месте.")+'</div>')},
 {key:"wide-table",subject:"Очень широкая таблица — проверка горизонтального overflow",text:"Wide table with 10 columns",html:'<!doctype html><html><body style="font-family:Arial,sans-serif"><h2>Широкая таблица</h2><table cellpadding="10" cellspacing="0" style="border-collapse:collapse;min-width:1200px;border:1px solid #ddd"><tr>'+Array.from({length:10},(_,i)=>'<th style="border:1px solid #ddd">Колонка '+(i+1)+'</th>').join("")+'</tr>'+Array.from({length:4},(_,r)=>'<tr>'+Array.from({length:10},(_,c)=>'<td style="border:1px solid #ddd">R'+(r+1)+' / C'+(c+1)+'</td>').join("")+'</tr>').join("")+'</table></body></html>'},
 {key:"legacy-table-layout",subject:"Legacy HTML: вложенные table layout",text:"Legacy table layout",html:'<html><body bgcolor="#eeeeee"><table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center"><table width="640" bgcolor="#ffffff" cellpadding="20"><tr><td><font face="Arial" size="5"><b>Legacy email</b></font></td></tr><tr><td><table width="100%" cellpadding="10"><tr><td width="50%" bgcolor="#fff4c7">Левая колонка</td><td width="50%" bgcolor="#f1f3f4">Правая колонка</td></tr></table></td></tr></table></td></tr></table></body></html>'},
 {key:"dark-hero",subject:"Тёмный hero-блок и светлый контент",text:"Dark hero",html:shell("Контраст",'<div style="background:#202124;color:#fff;padding:32px;border-radius:14px"><div style="font-size:30px;font-weight:700">Будущее уже здесь</div><p style="font-size:15px;line-height:1.6;color:#d8dde3">Проверка тёмного блока внутри светлого письма.</p><a href="https://schoolbook.kg" style="color:#f4c542">Подробнее →</a></div>')},
 {key:"responsive-columns",subject:"Responsive email — 3 колонки",text:"Responsive 3-column layout",html:'<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>body{font-family:Arial}.cols{display:flex;gap:12px}.col{flex:1;padding:18px;background:#f5f6f8;border-radius:10px}@media(max-width:600px){.cols{display:block}.col{margin:8px 0}}</style></head><body><h2>Три колонки</h2><div class="cols"><div class="col">Первая колонка</div><div class="col">Вторая колонка</div><div class="col">Третья колонка</div></div></body></html>'},
 {key:"long-content",subject:"Очень длинное письмо для проверки прокрутки",text:"Long message\n".repeat(80),html:shell("Длинное письмо",Array.from({length:45},(_,i)=>'<h3>Раздел '+(i+1)+'</h3><p class="p">Это длинный абзац для проверки высоты iframe, прокрутки reader, ответа внизу письма и сохранения позиции. '+("SchoolBook ".repeat(12))+'</p>').join(""))},
 {key:"long-url",subject:"Длинные URL и непрерывные строки",text:"https://example.com/"+("very-long-segment-".repeat(40)),html:shell("Перенос длинных строк",'<p class="p">Ниже URL без удобных точек переноса:</p><p style="font:13px monospace">https://example.com/'+("very-long-segment-".repeat(35))+'end</p><p style="font:13px monospace">'+("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(12))+'</p>')},
 {key:"unicode-emoji",subject:"Unicode 😎 🎓 Кириллица 中文 日本語",text:"Unicode: Привет, 世界, مرحبا, 🎓✨",html:shell("Unicode 🎓✨",'<p class="p">Русский: Привет, выпускники!</p><p class="p">中文：你好，世界。</p><p class="p">日本語：メール表示テスト。</p><p class="p">Emoji: 😀 😎 🎓 📸 ❤️ ✅ 🚀</p>')},
 {key:"rtl-arabic",subject:"RTL / العربية — смешанное направление",text:"مرحبا بكم في اختبار البريد",html:'<!doctype html><html><body style="font-family:Arial"><h2>RTL test</h2><div dir="rtl" style="max-width:650px;padding:20px;background:#f7f8fa">مرحبا بكم في اختبار عرض البريد الإلكتروني. هذا نص عربي طويل للتحقق من الاتجاه والمحاذاة.</div><p dir="ltr">Смешанный LTR блок после RTL.</p></body></html>'},
 {key:"rich-cyrillic",subject:"Русское деловое письмо с подписью",text:"Добрый день!\n\nПрикладываем информацию по заказу.\n\nС уважением,\nSchoolBook",html:shell("Добрый день!",'<p class="p">Прикладываем информацию по вашему заказу. Просим проверить <mark style="background:#fff4c7">выделенный фрагмент</mark> и подтвердить данные.</p><p class="p"><b>С уважением,</b><br>Команда SchoolBook<br><a href="mailto:mail@schoolbook.kg">mail@schoolbook.kg</a></p>')},
 {key:"thread-1",subject:"QA Thread — согласование макета",text:"Первое сообщение цепочки.",html:shell("Цепочка · сообщение 1",'<p class="p">Первое сообщение. Пожалуйста, посмотрите макет.</p>'),thread:true},
 {key:"thread-2",subject:"Re: QA Thread — согласование макета",text:"Второе сообщение цепочки.\n> Первое сообщение.",html:shell("Цепочка · сообщение 2",'<p class="p">Получили, внесём две правки.</p><blockquote>Первое сообщение. Пожалуйста, посмотрите макет.</blockquote>'),thread:true},
 {key:"thread-3",subject:"Re: QA Thread — согласование макета",text:"Третье сообщение цепочки.\n> Второе сообщение.",html:shell("Цепочка · сообщение 3",'<p class="p">Готово. Финальная версия согласована.</p><blockquote>Получили, внесём две правки.</blockquote>'),thread:true},
 {key:"tracking-pixel",subject:"Remote images + tracking pixel 1×1",text:"Tracking pixel test",html:shell("Privacy test",remoteHero("privacy-test","Внешняя картинка")+'<p class="p">В конце письма есть удалённый 1×1 tracking image.</p><img src="https://placehold.co/1x1/png?text=." width="1" height="1" alt="">')},
 {key:"cid-image",subject:"CID inline image внутри multipart/related",text:"CID inline image test",inlineCid:true,html:shell("Inline CID",'<p class="p">Изображение ниже загружено как CID-вложение:</p><img src="cid:schoolbook-inline@qa" width="64" height="64" alt="CID image" style="image-rendering:pixelated;border:1px solid #ddd">')},
 {key:"attachments-pdf-csv",subject:"PDF + CSV вложения",text:"Two attachment test",html:shell("Два вложения",'<p class="p">Проверяем список вложений, размер, скачивание и «Скачать все».</p>'),attachments:[{name:"schoolbook-qa.pdf",type:"application/pdf",data:pdf},{name:"orders.csv",type:"text/csv",data:csv}]},
 {key:"calendar-ics",subject:"Приглашение на встречу + ICS",text:"Calendar attachment test",html:shell("Встреча",'<p class="p"><b>1 октября, 15:00</b><br>Студия 1</p><p class="p">В письме приложен calendar.ics.</p>'),attachments:[{name:"schoolbook-meeting.ics",type:"text/calendar",data:ics}]},
 {key:"contact-vcf",subject:"Контакт VCF во вложении",text:"VCF attachment",html:shell("Контакт",'<p class="p">Проверяем неизвестный/контактный тип вложения.</p>'),attachments:[{name:"schoolbook-contact.vcf",type:"text/vcard",data:vcf}]},
 {key:"malformed-html",subject:"Неровный legacy HTML без закрывающих тегов",text:"Malformed HTML fallback",html:'<html><body><table width="640"><tr><td><h2>Намеренно неровный HTML</h2><p>Абзац без закрытия<p><b>Жирный блок<div style="margin:20px;background:#fff4c7;padding:20px">Блок div внутри legacy-разметки</table><p>Текст после таблицы</body>'},
 {key:"background-image",subject:"CSS background-image + fallback color",text:"Background image test",html:'<!doctype html><html><body><div style="max-width:700px;height:280px;background:#222 url(https://picsum.photos/seed/sb-bg/1200/500) center/cover no-repeat;color:white;padding:32px;box-sizing:border-box"><h1>Background image</h1><p>Если фон заблокирован, должен остаться тёмный fallback.</p></div></body></html>'},
 {key:"many-recipients",subject:"Много адресатов в To/Cc",text:"Many recipients header test",cc:"qa-copy-one@schoolbook.test, qa-copy-two@schoolbook.test, very.long.recipient.address.for.layout.testing@schoolbook.test",html:shell("Много получателей",'<p class="p">Проверяем раскрытие служебных заголовков Кому/Копия и длинные email-адреса.</p>')},
 {key:"long-subject-from",subject:"Очень длинная тема письма, которая должна корректно переноситься и не ломать панель открытого сообщения даже на средней ширине окна браузера",fromName:"Очень длинное имя отправителя для проверки переполнения интерфейса SchoolBook Mail",fromEmail:"very.long.sender.address.for.ui.testing@schoolbook.test",text:"Long subject and From headers",html:shell("Длинные заголовки",'<p class="p">Проверяем тему, From, служебную карточку и ellipsis только там, где он действительно нужен.</p>')},
 {key:"mixed-attachments",subject:"Смешанные вложения: JSON, ZIP, TXT, SVG",text:"Mixed attachments",html:shell("Набор вложений",'<p class="p">Проверяем безопасные и потенциально рискованные расширения, длинные имена и карточки файлов.</p>'),attachments:[
   {name:"order-metadata.json",type:"application/json",data:json},
   {name:"schoolbook-test-archive.zip",type:"application/zip",data:fakeZip},
   {name:"very-long-file-name-for-testing-attachment-layout-and-ellipsis-in-schoolbook-mail.txt",type:"text/plain",data:Buffer.from("Long attachment name test\n","utf8")},
   {name:"vector-preview.svg",type:"image/svg+xml",data:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120"><rect width="320" height="120" fill="#f4c542"/><text x="20" y="70" font-size="24">SchoolBook QA SVG</text></svg>',"utf8")}
 ]},
 {key:"mixed-complex",subject:"Финальный stress-test: HTML + картинки + 4 вложения",text:"Final mixed stress test",html:shell("Финальный stress-test",remoteHero("final-stress","Stress hero")+'<div class="grid">'+card("Карточка A","Текст с кириллицей, цифрами 123456 и символами © ® ™.")+card("Карточка B","Ссылка, длинный текст и responsive layout.")+'</div><table width="100%" cellpadding="8" style="margin-top:18px;border-collapse:collapse"><tr><td style="border:1px solid #ddd">A</td><td style="border:1px solid #ddd">B</td><td style="border:1px solid #ddd">C</td></tr></table><img src="https://placehold.co/1x1/png" width="1" height="1" alt="">'),attachments:[
   {name:"invoice.pdf",type:"application/pdf",data:pdf},
   {name:"report.csv",type:"text/csv",data:csv},
   {name:"event.ics",type:"text/calendar",data:ics},
   {name:"contact.vcf",type:"text/vcard",data:vcf}
 ]}
];

function prettyShell(kicker,title,body,accent="#f4c542"){
  const line="#e5e8ec",muted="#6f7782",ink="#202124";
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;padding:0;background:#f3f5f7">'+
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;background:#f3f5f7"><tr><td align="center" style="padding:28px 14px">'+
    '<table role="presentation" width="680" cellpadding="0" cellspacing="0" style="width:100%;max-width:680px;border-collapse:separate;border-spacing:0;background:#ffffff;border:1px solid '+line+';border-radius:16px;overflow:hidden">'+
    '<tr><td style="height:6px;background:'+accent+'"></td></tr><tr><td style="padding:30px 34px 12px">'+
    '<div style="margin:0 0 10px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:'+muted+'">'+esc(kicker)+'</div>'+
    '<div style="font-family:Arial,sans-serif;font-size:28px;line-height:1.25;font-weight:700;color:'+ink+'">'+title+'</div></td></tr>'+
    '<tr><td style="padding:14px 34px 30px">'+body+'</td></tr>'+
    '<tr><td style="padding:18px 34px;border-top:1px solid '+line+';background:#fafbfc;font-family:Arial,sans-serif;font-size:11px;line-height:1.5;color:'+muted+'">SchoolBook · HTML QA message</td></tr>'+
    '</table></td></tr></table></body></html>';
}
function prettyP(text){return '<p style="margin:0 0 15px;font-family:Arial,sans-serif;font-size:15px;line-height:1.65;color:#202124">'+text+'</p>'}
function prettyBtn(text,color="#f4c542",fg="#2e2500"){return '<span style="display:inline-block;padding:12px 18px;border-radius:9px;background:'+color+';color:'+fg+';font-family:Arial,sans-serif;font-size:13px;font-weight:700">'+esc(text)+'</span>'}
function prettyCard(title,text,accent="#f4c542"){return '<div style="margin:14px 0;padding:18px;border:1px solid #e5e8ec;border-left:4px solid '+accent+';border-radius:12px;background:#fff"><div style="margin-bottom:7px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#202124">'+esc(title)+'</div>'+prettyP(esc(text))+'</div>'}
function prettyRow(label,value){return '<tr><td style="padding:10px 0;border-bottom:1px solid #e5e8ec;font-family:Arial,sans-serif;font-size:13px;color:#6f7782">'+esc(label)+'</td><td align="right" style="padding:10px 0;border-bottom:1px solid #e5e8ec;font-family:Arial,sans-serif;font-size:13px;font-weight:700;color:#202124">'+esc(value)+'</td></tr>'}

const prettyScenarios=[
 {key:"pretty-payment",subject:"Оплата прошла успешно",fromName:"SchoolBook Billing",text:"Оплата заказа SB-4821 подтверждена. Сумма 12 450 сом.",html:prettyShell("Оплата","Спасибо! Оплата подтверждена",prettyP("Мы получили оплату по заказу <b>SB-4821</b>. Производство можно запускать без дополнительных действий.")+'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:18px 0">'+prettyRow("Заказ","#SB-4821")+prettyRow("Способ","Visa •••• 4281")+prettyRow("Сумма","12 450 сом")+"</table>"+prettyBtn("Открыть заказ"),"#188038")},
 {key:"pretty-production",subject:"Альбом передан в печать",fromName:"SchoolBook Production",text:"Заказ SB-4907 передан в печать.",html:prettyShell("Производство","Альбом уже в печати",prettyP("Макет проверен и отправлен в производство.")+prettyCard("Статус","Печать · в работе","#f4c542")+prettyCard("Ожидаемая готовность","29 сентября","#1a73e8")+prettyBtn("Следить за заказом"))},
 {key:"pretty-gallery",subject:"Фотографии готовы к выбору",fromName:"SchoolBook Studio",text:"В галерее доступно 148 фотографий.",html:prettyShell("Галерея","Фотографии готовы к выбору",prettyP("Мы загрузили новую съёмку. Выберите любимые кадры до <b>28 сентября</b>.")+'<div style="margin:20px 0;padding:22px;border-radius:14px;background:#f7f8fa;text-align:center"><div style="font-family:Arial,sans-serif;font-size:34px;font-weight:700;color:#202124">148</div><div style="font-family:Arial,sans-serif;font-size:12px;color:#6f7782">фотографий в галерее</div></div>'+prettyBtn("Открыть галерею"))},
 {key:"pretty-layout",subject:"Подтвердите финальный макет",fromName:"SchoolBook Design",text:"Финальный макет готов к согласованию.",html:prettyShell("Согласование","Финальный макет готов",prettyP("Мы внесли последние правки. Проверьте развороты и подтвердите печать.")+prettyCard("Важно","После подтверждения редактирование станет недоступно.","#b3261e")+prettyBtn("Посмотреть макет"))},
 {key:"pretty-delivery",subject:"Доставка назначена на завтра",fromName:"SchoolBook Delivery",text:"Курьер приедет завтра с 12:00 до 15:00.",html:prettyShell("Доставка","Заказ будет у вас завтра",prettyP("Курьер привезёт выпускные альбомы по указанному адресу.")+'<div style="padding:20px;border-radius:14px;background:#e8f0fe"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:#1a73e8">ВРЕМЯ</div><div style="margin-top:4px;font-family:Arial,sans-serif;font-size:24px;font-weight:700;color:#202124">12:00–15:00</div><div style="margin-top:8px;font-family:Arial,sans-serif;font-size:13px;color:#6f7782">Бишкек · ул. Тестовая, 24</div></div>',"#1a73e8")},
 {key:"pretty-comment",subject:"Новый комментарий к макету",fromName:"Мария · SchoolBook",text:"Давайте сделаем фото на 3 развороте немного крупнее.",html:prettyShell("Комментарий","Мария оставила замечание",'<div style="padding:18px 20px;border-radius:12px;background:#f7f8fa;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#202124">“Давайте сделаем фото на 3 развороте немного крупнее и уберём подпись справа.”</div>'+prettyP("<b>Разворот №3</b> · комментарий добавлен только что"))},
 {key:"pretty-report",subject:"Еженедельный отчёт по заказам",fromName:"SchoolBook Reports",text:"28 новых заказов, 19 оплачено, 12 отправлено в печать.",html:prettyShell("Отчёт","Итоги недели",'<table role="presentation" width="100%" cellpadding="6" cellspacing="0"><tr><td style="width:33%;padding:6px"><div style="padding:16px;border-radius:12px;background:#e8f0fe;font-family:Arial,sans-serif"><small style="color:#6f7782">Новые</small><div style="font-size:24px;font-weight:700;color:#202124">28</div></div></td><td style="width:33%;padding:6px"><div style="padding:16px;border-radius:12px;background:#e6f4ea;font-family:Arial,sans-serif"><small style="color:#6f7782">Оплачено</small><div style="font-size:24px;font-weight:700;color:#202124">19</div></div></td><td style="width:33%;padding:6px"><div style="padding:16px;border-radius:12px;background:#fff8d8;font-family:Arial,sans-serif"><small style="color:#6f7782">В печати</small><div style="font-size:24px;font-weight:700;color:#202124">12</div></div></td></tr></table>'+prettyCard("Требуют внимания","У 4 заказов не подтверждён финальный макет.","#b3261e"))},
 {key:"pretty-welcome",subject:"Добро пожаловать в SchoolBook",fromName:"Команда SchoolBook",text:"Начните с создания первого проекта.",html:prettyShell("Добро пожаловать","Рады видеть вас в SchoolBook",prettyP("Три шага для быстрого старта:")+prettyCard("01 · Проект","Создайте первый выпускной проект.","#1a73e8")+prettyCard("02 · Клиенты","Добавьте контакты родителей и учеников.","#f4c542")+prettyCard("03 · Фотографии","Загрузите съёмку и откройте выбор.","#188038"))},
 {key:"pretty-code",subject:"Код входа: 482 917",fromName:"SchoolBook Security",text:"Код 482 917 действует 10 минут.",html:prettyShell("Безопасность","Код для входа",prettyP("Введите этот код в окне авторизации:")+'<div style="margin:20px 0;padding:22px;border:1px solid #e5e8ec;border-radius:14px;background:#f7f8fa;text-align:center;font-family:Arial,sans-serif;font-size:32px;font-weight:700;letter-spacing:6px;color:#202124">482 917</div>'+prettyP("Код действует 10 минут. Никому не сообщайте его."),"#1a73e8")},
 {key:"pretty-security",subject:"Новый вход в аккаунт",fromName:"SchoolBook Security",text:"Chrome, Windows, Бишкек.",html:prettyShell("Безопасность","Новый вход в аккаунт",prettyP("Мы заметили авторизацию с нового устройства.")+'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">'+prettyRow("Устройство","Chrome · Windows")+prettyRow("Город","Бишкек")+prettyRow("Время","Сегодня, 09:02")+"</table>"+prettyCard("Если это были не вы","Смените пароль и завершите активные сеансы.","#b3261e"),"#b3261e")},
 {key:"pretty-invoice",subject:"Счёт № 2026-091",fromName:"SchoolBook Finance",text:"Итого к оплате 38 700 сом.",html:prettyShell("Счёт","Счёт № 2026-091",prettyP("Оплатить до <b>30 сентября 2026</b>.")+'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:16px 0">'+prettyRow("Печать альбомов · 30 шт.","36 000 сом")+prettyRow("Доставка","2 700 сом")+prettyRow("Итого","38 700 сом")+"</table>"+prettyBtn("Оплатить счёт"))},
 {key:"pretty-deadline",subject:"Согласование заканчивается сегодня",fromName:"SchoolBook",text:"Сегодня последний день согласования макета.",html:prettyShell("Напоминание","Сегодня последний день",prettyP("До конца дня нужно подтвердить макет класса <b>11-А</b>.")+'<div style="margin:20px 0;padding:18px;border-radius:12px;background:#fff8d8;border:1px solid #f3dc86"><div style="font-family:Arial,sans-serif;font-size:11px;font-weight:700;color:#7a5a00">ОСТАЛОСЬ</div><div style="font-family:Arial,sans-serif;font-size:27px;font-weight:700;color:#202124">8 часов</div></div>'+prettyBtn("Подтвердить макет"))},
 {key:"pretty-support-new",subject:"Ваше обращение принято",fromName:"SchoolBook Support",text:"Обращение #2148 принято.",html:prettyShell("Поддержка","Мы получили ваше обращение",prettyP("Номер обращения: <b>#2148</b>. Команда поддержки уже видит сообщение.")+prettyCard("Тема","Не отображается фотография в макете","#1a73e8")+prettyP("Среднее время ответа сегодня — около <b>35 минут</b>."),"#1a73e8")},
 {key:"pretty-support-answer",subject:"Ответ поддержки по обращению #2148",fromName:"Евгений · SchoolBook",text:"Проблема исправлена.",html:prettyShell("Поддержка","Проблема исправлена",prettyP("Мы пересобрали превью макета. Обновите страницу и проверьте третий разворот ещё раз.")+'<div style="margin:18px 0;padding:16px 18px;border-radius:12px;background:#e6f4ea;color:#188038;font-family:Arial,sans-serif;font-size:13px;font-weight:700">✓ Исправление уже применено</div>'+prettyBtn("Открыть макет"))},
 {key:"pretty-update",subject:"Новая версия SchoolBook Mail",fromName:"SchoolBook Product",text:"Обновлены HTML письма, поиск и ответы.",html:prettyShell("Обновление","SchoolBook Mail стал удобнее",prettyCard("HTML-письма","Сохраняют исходное форматирование.","#188038")+prettyCard("Поиск","Быстрее находит нужную переписку.","#1a73e8")+prettyCard("Ответы","Компактнее и ближе к логике Gmail.","#f4c542"))},
 {key:"pretty-progress",subject:"Галерея закроется через 2 дня",fromName:"SchoolBook Gallery",text:"Выбрано 17 из 24 фотографий.",html:prettyShell("Галерея","Осталось выбрать 7 фотографий",prettyP("Ваш текущий прогресс:")+'<div style="margin:18px 0;height:12px;border-radius:999px;background:#eceff2;overflow:hidden"><div style="width:71%;height:12px;background:#f4c542"></div></div><div style="font-family:Arial,sans-serif;font-size:12px;color:#6f7782">17 выбрано · 24 нужно</div><div style="margin-top:20px">'+prettyBtn("Продолжить выбор")+"</div>")},
 {key:"pretty-contract",subject:"Договор ожидает подписи",fromName:"SchoolBook Documents",text:"Договор SB-DOC-871 ожидает подписи до 1 октября.",html:prettyShell("Документы","Нужна ваша подпись",prettyP("Договор на изготовление выпускных альбомов подготовлен.")+'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">'+prettyRow("Документ","SB-DOC-871")+prettyRow("Класс","11-А")+prettyRow("Срок","1 октября 2026")+"</table><div style=\"margin-top:20px\">"+prettyBtn("Открыть договор","#7b1fa2","#ffffff")+"</div>","#7b1fa2")},
 {key:"pretty-thanks",subject:"Спасибо за заказ!",fromName:"SchoolBook",text:"Ваш заказ завершён. Нам важно ваше мнение.",html:prettyShell("Спасибо","Ваш заказ завершён",prettyP("Альбомы выданы, заказ <b>#SB-4720</b> завершён. Спасибо, что выбрали SchoolBook.")+'<div style="margin:22px 0;text-align:center;font-family:Arial,sans-serif"><div style="font-size:12px;color:#6f7782;margin-bottom:10px">Как вам результат?</div><div style="font-size:30px;letter-spacing:6px;color:#f4c542">☆ ☆ ☆ ☆ ☆</div></div>'+prettyBtn("Оставить отзыв"))},
 {key:"pretty-shoot",subject:"План съёмочного дня",fromName:"SchoolBook Studio",text:"3 октября: сбор 08:40, портреты 09:00, общее фото 11:30.",html:prettyShell("Съёмка","План на 3 октября",prettyCard("08:40 · Сбор","Проверяем списки и готовность класса.","#1a73e8")+prettyCard("09:00 · Портреты","Индивидуальная съёмка учеников.","#f4c542")+prettyCard("11:30 · Общее фото","Групповые кадры класса.","#188038"))},
 {key:"pretty-analytics",subject:"Месячная сводка: сентябрь",fromName:"SchoolBook Analytics",text:"126 заказов, 94 оплачено, выручка 1 248 000 сом.",html:prettyShell("Аналитика","Сентябрь в цифрах",'<table role="presentation" width="100%" cellpadding="6" cellspacing="0"><tr><td style="padding:6px"><div style="padding:18px;border-radius:12px;background:#e8f0fe;font-family:Arial,sans-serif"><small style="color:#6f7782">Заказы</small><div style="font-size:24px;font-weight:700">126</div></div></td><td style="padding:6px"><div style="padding:18px;border-radius:12px;background:#e6f4ea;font-family:Arial,sans-serif"><small style="color:#6f7782">Оплачено</small><div style="font-size:24px;font-weight:700">94</div></div></td><td style="padding:6px"><div style="padding:18px;border-radius:12px;background:#fff8d8;font-family:Arial,sans-serif"><small style="color:#6f7782">Выручка</small><div style="font-size:20px;font-weight:700">1,248M</div></div></td></tr></table>'+prettyP("Конверсия выросла на <b>8,4%</b> по сравнению с августом."))}
];

const scenarios=PRETTY_ONLY?prettyScenarios:baseScenarios;
const expectedCount=PRETTY_ONLY?20:30;
if(scenarios.length!==expectedCount)throw new Error("Expected exactly "+expectedCount+" QA scenarios, got "+scenarios.length);

// Connect thread messages 17-19 together.
const threadIds=["<qa-"+runTag+"-17@schoolbook.test>","<qa-"+runTag+"-18@schoolbook.test>","<qa-"+runTag+"-19@schoolbook.test>"];
scenarios[17].inReplyTo=threadIds[0];scenarios[17].references=threadIds[0];
scenarios[18].inReplyTo=threadIds[1];scenarios[18].references=threadIds[0]+" "+threadIds[1];

const mimeMessages=scenarios.map((item,index)=>buildMime(item,index));

if(DRY_RUN){
  console.log("Prepared "+mimeMessages.length+" QA messages:");
  scenarios.forEach((s,i)=>console.log(String(i+1).padStart(2,"0")+". "+s.key+" — "+s.subject));
  console.log("\nNo server connection was made (--dry-run).");
  process.exit(0);
}

function resolveUrl(value,base=JMAP_URL){
  if(!value)throw new Error("Missing URL in JMAP session");
  return new URL(value,base).toString();
}
async function jsonFetch(url,init={}){
  const r=await fetch(url,{...init,headers:{Authorization:auth,...(init.headers||{})}});
  const body=await r.text();
  let data;
  try{data=JSON.parse(body)}catch{data=null}
  if(!r.ok)throw new Error("HTTP "+r.status+" "+r.statusText+" from "+url+(body?" — "+body.slice(0,500):""));
  return data;
}
async function jmap(apiUrl,methodCalls){
  const data=await jsonFetch(apiUrl,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({using:["urn:ietf:params:jmap:core","urn:ietf:params:jmap:mail"],methodCalls})
  });
  if(!Array.isArray(data?.methodResponses))throw new Error("Invalid JMAP response");
  return data.methodResponses;
}

console.log("Connecting to "+JMAP_URL+" as "+USER+"…");
const session=await jsonFetch(JMAP_URL);
const accountId=session.primaryAccounts?.["urn:ietf:params:jmap:mail"]||Object.keys(session.accounts||{})[0];
if(!accountId)throw new Error("No JMAP mail account in session");
const apiUrl=resolveUrl(session.apiUrl);
const uploadUrl=resolveUrl(String(session.uploadUrl).replace("{accountId}",encodeURIComponent(accountId)));

const mailboxResponses=await jmap(apiUrl,[["Mailbox/get",{accountId,properties:["id","name","role"]},"m1"]]);
const mailboxGet=mailboxResponses.find(x=>x[0]==="Mailbox/get")?.[1];
const inbox=mailboxGet?.list?.find(x=>x.role==="inbox")||mailboxGet?.list?.find(x=>String(x.name||"").toLowerCase()==="inbox");
if(!inbox?.id)throw new Error("Inbox mailbox not found");

console.log("Uploading "+expectedCount+" RFC822 messages…");
const uploaded=[];
for(let i=0;i<mimeMessages.length;i++){
  const r=await fetch(uploadUrl,{
    method:"POST",
    headers:{Authorization:auth,"content-type":"message/rfc822"},
    body:Buffer.from(mimeMessages[i],"utf8")
  });
  const body=await r.text();
  if(!r.ok)throw new Error("Upload "+(i+1)+" failed: HTTP "+r.status+" — "+body.slice(0,500));
  const data=JSON.parse(body);
  if(!data.blobId)throw new Error("Upload "+(i+1)+" returned no blobId");
  uploaded.push(data);
  process.stdout.write("\rUploaded "+String(i+1).padStart(2," ")+" / "+expectedCount);
}
process.stdout.write("\n");

const imports={};
for(let i=0;i<uploaded.length;i++){
  imports["qa"+String(i+1).padStart(2,"0")]={
    blobId:uploaded[i].blobId,
    mailboxIds:{[inbox.id]:true},
    keywords:i%5===0?{"$seen":true}:{},
    receivedAt:new Date(Date.now()-(30-i)*7*60*1000).toISOString()
  };
}
const importResponses=await jmap(apiUrl,[["Email/import",{accountId,emails:imports},"import1"]]);
const imported=importResponses.find(x=>x[0]==="Email/import")?.[1];
if(!imported)throw new Error("Email/import response missing");
const failures=Object.entries(imported.notCreated||{});
if(failures.length){
  console.error("Some imports failed:");
  for(const [key,value] of failures)console.error(" - "+key+": "+JSON.stringify(value));
}
const successCount=Object.keys(imported.created||{}).length;
console.log("Imported "+successCount+" / "+expectedCount+" QA messages into Inbox.");
console.log("Scenarios:");
scenarios.forEach((s,i)=>console.log(" "+String(i+1).padStart(2,"0")+". "+s.key));
if(successCount!==expectedCount)process.exitCode=1;
