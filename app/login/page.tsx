"use client";

import {FormEvent,useState} from "react";
import {Eye,EyeOff,LockKeyhole,Mail} from "lucide-react";
import {useRouter} from "next/navigation";
import "./login.css";

export default function Login(){
 const router=useRouter();
 const [email,setEmail]=useState("");
 const [password,setPassword]=useState("");
 const [show,setShow]=useState(false);
 const [error,setError]=useState("");
 const [loading,setLoading]=useState(false);

 async function submit(e:FormEvent){
  e.preventDefault();
  if(loading)return;
  setError("");
  setLoading(true);
  try{
   const r=await fetch("/api/auth/login",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password})});
   const d=await r.json().catch(()=>({}));
   if(!r.ok){setError(d.error||"Не удалось войти в почту");return}
   router.replace("/");
   router.refresh();
  }catch{
   setError("Сервер временно недоступен");
  }finally{
   setLoading(false);
  }
 }

 return <main className="authPage">
  <section className="authShell">
   <div className="authIntro">
    <div className="authBrand"><img src="/schoolbook-logo.webp" alt="SchoolBook"/><span>Mail</span></div>
    <div className="authIntroCopy">
     <span className="authEyebrow">SCHOOLBOOK MAIL</span>
     <h1>Почта для ежедневной работы.</h1>
     <p>Все рабочие письма, переписки и вложения — в одном аккуратном интерфейсе SchoolBook.</p>
    </div>
    <div className="authIntroFoot"><span/><p>SchoolBook</p></div>
   </div>

   <div className="authFormSide">
    <form className="authCard" onSubmit={submit} noValidate>
     <header className="authCardHead">
      <div className="authMobileBrand"><img src="/schoolbook-logo.webp" alt="SchoolBook"/><span>Mail</span></div>
      <h2>Вход в почту</h2>
      <p>Введите данные вашего почтового аккаунта.</p>
     </header>

     <label className="authField">
      <span>Электронная почта</span>
      <div className="authInput">
       <Mail/>
       <input
        type="email"
        inputMode="email"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        autoComplete="username"
        value={email}
        onChange={e=>{setEmail(e.target.value);if(error)setError("")}}
        placeholder="name@schoolbook.kg"
        required
        autoFocus
       />
      </div>
     </label>

     <label className="authField">
      <span>Пароль</span>
      <div className="authInput">
       <LockKeyhole/>
       <input
        type={show?"text":"password"}
        autoComplete="current-password"
        value={password}
        onChange={e=>{setPassword(e.target.value);if(error)setError("")}}
        placeholder="Введите пароль"
        required
       />
       <button className="authPasswordToggle" type="button" onClick={()=>setShow(v=>!v)} aria-label={show?"Скрыть пароль":"Показать пароль"} title={show?"Скрыть пароль":"Показать пароль"}>
        {show?<EyeOff/>:<Eye/>}
       </button>
      </div>
     </label>

     {error&&<div className="authError" role="alert"><span/>{error}</div>}

     <button className="authSubmit" type="submit" disabled={loading||!email.trim()||!password}>
      {loading?<><span className="authSpinner"/>Входим…</>:"Войти"}
     </button>

     <footer className="authCardFoot">SchoolBook Mail</footer>
    </form>
   </div>
  </section>
 </main>
}
