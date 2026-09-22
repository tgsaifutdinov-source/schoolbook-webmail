"use client";
import {useMemo,useState} from "react";
import {Archive,ChevronDown,Clock3,FileText,Folder,Inbox,Menu,MoreHorizontal,Paperclip,PenLine,Plus,Reply,Search,Send,Settings2,Sparkles,Star,Trash2,X} from "lucide-react";

const messages=[
{id:1,name:"Анна Иванова",initial:"А",subject:"Выпускной альбом — заказ №4587",preview:"Добрый день! Хотела уточнить статус заказа...",time:"14:32",unread:true,tag:"Клиенты",body:"Добрый день! Хотела уточнить статус нашего заказа на выпускной альбом. Подскажите, пожалуйста, когда будет готов макет?"},
{id:2,name:"SchoolBook",initial:"S",subject:"Ваш заказ готов к проверке",preview:"Макет альбома готов. Можно посмотреть...",time:"12:10",unread:true,tag:"Заказы",body:"Макет альбома готов к проверке. Откройте заказ и оставьте комментарии, если потребуются изменения."},
{id:3,name:"Максим Орлов",initial:"М",subject:"Фотографии для альбома",preview:"Загрузил фотографии с последней съёмки...",time:"10:45",tag:"Клиенты",body:"Загрузил фотографии с последней съёмки. Посмотрите, пожалуйста, всё ли подходит."},
{id:4,name:"Елена Смирнова",initial:"Е",subject:"Re: Дизайн обложки",preview:"Мне нравится второй вариант...",time:"Вчера",tag:"Клиенты",body:"Мне нравится второй вариант обложки. Давайте остановимся на нём."},
{id:5,name:"Photo Lab",initial:"P",subject:"Печать заказа завершена",preview:"Заказ передан в отдел упаковки...",time:"Вчера",tag:"Производство",body:"Печать заказа завершена. Заказ передан в отдел упаковки."},
{id:6,name:"Ольга Сергеева",initial:"О",subject:"Оплата заказа прошла",preview:"Спасибо, оплату получили. Что дальше?",time:"Пн",tag:"Заказы",body:"Спасибо, оплату получили. Подскажите, пожалуйста, какой следующий этап?"}
];
const folders=[["Входящие",Inbox,"12"],["Избранное",Star,""],["Отправленные",Send,""],["Черновики",FileText,"3"],["Архив",Archive,""],["Корзина",Trash2,""]] as const;

export default function Home(){
 const [selected,setSelected]=useState(messages[0]); const [compose,setCompose]=useState(false); const [mobile,setMobile]=useState(false); const [query,setQuery]=useState(""); const [tab,setTab]=useState("Все");
 const filtered=useMemo(()=>messages.filter(m=>(tab==="Все"||tab==="Непрочитанные"&&m.unread)&&(m.name+" "+m.subject+" "+m.preview).toLowerCase().includes(query.toLowerCase())),[query,tab]);
 return <main className="shell">
  <header className="topbar"><button className="mobileMenu" onClick={()=>setMobile(!mobile)}><Menu/></button><div className="brand"><span className="brandMark"><span>S</span></span><div><b>SchoolBook</b><small>MAIL</small></div></div>
   <div className="search"><Search/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Поиск писем, контактов, файлов…"/><kbd>⌘ K</kbd></div>
   <button className="aiButton"><Sparkles/><span>AI-помощник</span></button><div className="account"><span className="avatar">ТС</span><div><b>Тимур</b><small>admin@schoolbook.kg</small></div><ChevronDown/></div>
  </header>
  <div className="workspace">
   <aside className={mobile?"open":""}><button className="compose" onClick={()=>setCompose(true)}><PenLine/>Новое письмо</button>
    <nav>{folders.map(([label,Icon,count],i)=><button className={i===0?"active":""} key={label}><Icon/><span>{label}</span>{count&&<em>{count}</em>}</button>)}</nav>
    <div className="sectionTitle"><span>Мои папки</span><button><Plus/></button></div><nav className="customFolders"><button><i className="dot clients"/>Клиенты</button><button><i className="dot orders"/>Заказы</button><button><i className="dot production"/>Производство</button></nav>
    <div className="asideBottom"><div className="storage"><div><span>Хранилище</span><b>2,4 / 15 ГБ</b></div><i><u/></i><small>Использовано 16%</small></div><button className="settings"><Settings2/>Настройки</button></div>
   </aside>
   <section className="list"><div className="listHead"><div><h1>Входящие</h1><span>12 непрочитанных</span></div><button className="iconButton"><MoreHorizontal/></button></div>
    <div className="tabs">{["Все","Непрочитанные"].map(x=><button key={x} onClick={()=>setTab(x)} className={tab===x?"active":""}>{x}</button>)}</div>
    <div className="messages">{filtered.map(m=><article onClick={()=>setSelected(m)} className={(selected.id===m.id?"selected ":"")+(m.unread?"unread":"")} key={m.id}><span className={"senderAvatar a"+m.id}>{m.initial}</span><div className="msg"><div><b>{m.name}</b><time>{m.time}</time></div><strong>{m.subject}</strong><p>{m.preview}</p><small className="tag">{m.tag}</small></div><button className="star"><Star/></button></article>)}</div>
   </section>
   <section className="reader"><div className="toolbar"><div><button><Archive/></button><button><Trash2/></button><button><Clock3/></button></div><div><button><Reply/></button><button><MoreHorizontal/></button></div></div>
    <div className="letter"><div className="subjectLine"><div><span className="eyebrow">ВХОДЯЩИЕ · {selected.tag.toUpperCase()}</span><h2>{selected.subject}</h2></div><button className="favorite"><Star/></button></div>
     <div className="from"><span className={"senderAvatar big a"+selected.id}>{selected.initial}</span><div><b>{selected.name}</b><small>кому: мне <ChevronDown/></small></div><time>{selected.time}</time></div>
     <div className="body"><p>Здравствуйте!</p><p>{selected.body}</p><p>Спасибо!</p></div>
     <div className="attachment"><div className="fileIcon"><FileText/></div><div><b>Материалы заказа.pdf</b><small>PDF · 4,8 МБ</small></div><button>Открыть</button></div>
     <div className="actions"><button className="primary"><Reply/>Ответить</button><button>Переслать</button></div>
    </div>
   </section>
  </div>
  {compose&&<><div className="scrim" onClick={()=>setCompose(false)}/><div className="composeWindow"><div className="composeHead"><div><b>Новое сообщение</b><small>Черновик сохранён</small></div><button onClick={()=>setCompose(false)}><X/></button></div><label><span>Кому</span><input autoFocus placeholder="Имя или email"/></label><label><span>Тема</span><input placeholder="Тема письма"/></label><textarea placeholder="Напишите сообщение…"/><div className="composeFoot"><button className="send"><Send/>Отправить</button><button><Paperclip/></button><span/><button onClick={()=>setCompose(false)}><Trash2/></button></div></div></>}
 </main>
}