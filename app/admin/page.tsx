'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {ArrowLeft,ShieldCheck,UserPlus,Copy,LockKeyhole,RefreshCw} from 'lucide-react';
import {canManage,roleNames,type MemberRole,type Session} from '../access-model';
type Member={email:string;name:string;role:MemberRole;active:boolean;revision:number;joined:boolean;self:boolean};
type Data={session:Session;owner:{name:string;email:string};members:Member[]};
export default function Admin(){
 const [data,setData]=useState<Data|null>(null),[error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false),[email,setEmail]=useState(''),[role,setRole]=useState<MemberRole>('viewer');
 const [demo,setDemo]=useState(false);
 async function load(){
  try{
   const r=await fetch('/api/members',{cache:'no-store'});const body=await r.json() as Data&{error?:string};
   if(r.status===401&&process.env.NODE_ENV==='development'){
    setDemo(true);setData({session:{role:'superadmin',userId:'preview-owner',email:'owner@example.com',name:'Владелец',boardId:'preview-owner'},owner:{name:'Владелец',email:'owner@example.com'},members:[]});return;
   }
   if(!r.ok){if(r.status===401||r.status===403)setData(null);throw new Error(body.error||'Не удалось загрузить пользователей.');}
   setData(body);setError('');
  }catch(e){setError((e as Error).message)}
 }
 useEffect(()=>{load()},[]);
 async function add(e:FormEvent){
  e.preventDefault();setBusy(true);setError('');setMessage('');
  try{
   if(demo){setData(current=>current?{...current,members:[...current.members,{email:email.trim().toLowerCase(),name:'',role,active:true,revision:1,joined:false,self:false}]}:current)}
   else{const r=await fetch('/api/members',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,role})});const body=await r.json() as {error:string};if(!r.ok)throw new Error(body.error);await load()}
   setMessage('Права добавлены. Для первого входа этому email также нужен доступ к самому сайту.');setEmail('');setRole('viewer');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function change(member:Member,nextRole:MemberRole,active:boolean){
  setBusy(true);setError('');setMessage('');
  try{
   if(demo)setData(current=>current?{...current,members:current.members.map(m=>m.email===member.email?{...m,role:nextRole,active,revision:m.revision+1}:m)}:current);
   else{const r=await fetch('/api/members',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:member.email,role:nextRole,active,revision:member.revision})});const body=await r.json() as {error:string};if(!r.ok)throw new Error(body.error);await load()}
   setMessage(active?'Права сохранены.':'Доступ к задачам закрыт.');
  }catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 async function copyLink(){try{await navigator.clipboard.writeText(location.origin+'/');setMessage('Ссылка на облака скопирована.')}catch{setMessage('Ссылка на облака: '+location.origin+'/')}}
 return <div className="admin-page">
  <header className="admin-top"><a href="/" aria-label="Назад к облакам"><ArrowLeft size={22}/>Облака</a><span><ShieldCheck size={18}/>{data?roleNames[data.session.role]:'Доступ'}</span></header>
  <main className="admin-main"><h1>Пользователи и доступ</h1><p className="admin-intro">Одна общая доска. Каждый входит через свой аккаунт ChatGPT.</p>
   {demo&&<p className="admin-notice">Предпросмотр · пользователи здесь вымышленные, изменения не отправляются.</p>}
   {error&&<div className="admin-error" role="alert">{error}<button onClick={load}>Повторить</button></div>}
   {message&&<div className="admin-message" role="status">{message}</div>}
   {!data?<div className="admin-card">{error?<a href="/signin-with-chatgpt?return_to=/admin" target="_top">Войти через ChatGPT</a>:'Загрузка…'}</div>:<>
    <section className="admin-card owner-card"><span className="member-avatar"><ShieldCheck size={23}/></span><div><h2>{data.owner.name||'Владелец'}</h2><p>{data.owner.email}</p><span className="role-pill">Суперадминистратор</span></div><LockKeyhole size={20} aria-label="Защищённый владелец"/><p className="owner-description">Полный доступ к задачам и пользователям. Только суперадминистратор назначает администраторов. Эту роль нельзя изменить или отозвать здесь.</p></section>
    <section className="admin-card"><h2><UserPlus size={20}/>Добавить пользователя</h2><form className="invite-form" onSubmit={add}><label>Email аккаунта ChatGPT<input type="email" autoComplete="email" required maxLength={254} placeholder="name@example.com" value={email} onChange={e=>setEmail(e.target.value)}/></label><label>Права<select value={role} onChange={e=>setRole(e.target.value as MemberRole)}><option value="viewer">Просмотр</option><option value="editor">Редактор</option>{data.session.role==='superadmin'&&<option value="admin">Администратор</option>}</select></label><button className="primary" disabled={busy||!email.trim()}>Добавить</button></form>
     <p className="admin-hint">Пользователь получит доступ ко всем облакам, включая архив и корзину. Если ChatGPT использует скрытый email Apple, нужен именно этот адрес.</p>
    </section>
    <section className="admin-card access-steps"><h2>Первый вход</h2><p>Кроме роли на доске, человеку нужен доступ к закрытому сайту. После добавления email попросите ChatGPT пригласить этот же email на сайт «Облака». Эта панель не отправляет приглашения.</p><button className="secondary" onClick={copyLink}><Copy size={17}/>Скопировать ссылку на облака</button></section>
    <section><div className="members-heading"><h2>Участники <span>{data.members.length}</span></h2><button aria-label="Обновить пользователей" onClick={load} disabled={busy||demo}><RefreshCw size={18}/></button></div>{!data.members.length?<div className="admin-card no-members">Пока только вы. Добавьте email первого участника выше.</div>:<div className="member-list">{data.members.map(m=><MemberCard key={m.email+':'+m.revision} member={m} actor={data.session} busy={busy} onChange={change}/>)}</div>}</section>
    <section className="role-guide"><p><b>Просмотр</b> — читать и искать задачи.</p><p><b>Редактор</b> — также добавлять, менять, выполнять и перемещать задачи.</p><p><b>Администратор</b> — также управлять зрителями и редакторами.</p></section>
   </>}
  </main>
 </div>;
}
function MemberCard({member,actor,busy,onChange}:{member:Member;actor:Session;busy:boolean;onChange:(m:Member,role:MemberRole,active:boolean)=>void}){
 const [role,setRole]=useState(member.role);const editable=!member.self&&canManage(actor.role,member.role,member.role);
 return <article className={'admin-card member-card'+(!member.active?' revoked':'')}><div className="member-info"><h3>{member.name||member.email}{member.self&&<small> · вы</small>}</h3>{member.name&&<p>{member.email}</p>}<span className={'member-status '+(!member.active?'off':'')}>{!member.active?'Доступ закрыт':member.joined?'Вход выполнен':'Ожидает первого входа'}</span></div><div className="member-controls">{editable?<><select aria-label={'Роль '+member.email} value={role} onChange={e=>setRole(e.target.value as MemberRole)} disabled={busy}><option value="viewer">Просмотр</option><option value="editor">Редактор</option>{actor.role==='superadmin'&&<option value="admin">Администратор</option>}</select><button className="secondary" disabled={busy||role===member.role} onClick={()=>onChange(member,role,member.active)}>Сохранить</button><button className={member.active?'revoke':'secondary'} disabled={busy} onClick={()=>onChange(member,member.role,!member.active)}>{member.active?'Закрыть доступ':'Вернуть доступ'}</button></>:<span className="role-pill">{roleNames[member.role]}</span>}</div></article>;
}
