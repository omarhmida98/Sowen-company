'use client';
import {useEffect,useState} from 'react';
import {Copy,KeyRound,Send,Trash2,UserPlus} from 'lucide-react';
import {api} from '@/lib/api';
import {storedUser} from '@/lib/session';
type Member={id:string;email:string;displayName?:string|null;role:'ADMIN'|'EDITOR'|'USER';createdAt:string;status:'ACTIVE'|'INVITED'|'RESET_PENDING';linkExpiresAt?:string|null;linkExpired?:boolean};
// How an invitation or reset link reached the user: by email, or shown once to the administrator.
type Delivery={delivery:'EMAIL_SENT'|'LINK_ONLY';link?:string;reason?:string;expiresAt:string};
type Outcome=Delivery&{email:string;kind:'invite'|'resend'|'reset'};
const fmt=(d?:string|null)=>d?new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(d)):'—';
function statusBadge(u:Member){
  if(u.status==='ACTIVE')return <span className="badge green">Actif</span>;
  if(u.linkExpired)return <span className="badge red">Lien expiré</span>;
  return <span className="badge yellow">{u.status==='INVITED'?'Invitation envoyée':'Réinitialisation en attente'}</span>;
}
export function TeamManager(){
  const[rows,setRows]=useState<Member[]>([]),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[busy,setBusy]=useState(false),[outcome,setOutcome]=useState<Outcome|null>(null),[copied,setCopied]=useState(false),[confirm,setConfirm]=useState<{kind:'reset'|'remove';user:Member}|null>(null),[me,setMe]=useState('');
  const load=()=>api<Member[]>('/users').then(setRows).catch((e:any)=>{setMsg(e.message);setIsErr(true)});
  useEffect(()=>{setMe(storedUser()?.id||'');load()},[]);
  const fail=(e:any)=>{setMsg(e.message);setIsErr(true)};
  const done=(o:Outcome)=>{setOutcome(o);setCopied(false);setMsg('');setIsErr(false)};
  async function invite(e:any){e.preventDefault();setBusy(true);setMsg('');setIsErr(false);setOutcome(null);const form=e.currentTarget as HTMLFormElement;const f=new FormData(form);const email=String(f.get('email')||'');try{const r=await api<Delivery>('/users',{method:'POST',body:JSON.stringify({displayName:f.get('displayName'),email,role:f.get('role')})});form.reset();await load();done({...r,email,kind:'invite'})}catch(e:any){fail(e)}finally{setBusy(false)}}
  async function resend(u:Member){setBusy(true);setOutcome(null);try{const r=await api<Delivery>(`/users/${u.id}/invitation`,{method:'POST'});await load();done({...r,email:u.email,kind:'resend'})}catch(e:any){fail(e)}finally{setBusy(false)}}
  async function reset(u:Member){setConfirm(null);setBusy(true);setOutcome(null);try{const r=await api<Delivery>(`/users/${u.id}/reset-password`,{method:'POST'});await load();done({...r,email:u.email,kind:'reset'})}catch(e:any){fail(e)}finally{setBusy(false)}}
  async function role(id:string,role:string){try{await api(`/users/${id}/role`,{method:'PATCH',body:JSON.stringify({role})});await load();setMsg('Rôle mis à jour. Il s’applique immédiatement.');setIsErr(false)}catch(e:any){fail(e);load()}}
  async function remove(u:Member){setConfirm(null);try{await api(`/users/${u.id}`,{method:'DELETE'});await load();setOutcome(null);setMsg('Utilisateur supprimé. Son accès est coupé immédiatement.');setIsErr(false)}catch(e:any){fail(e)}}
  async function copy(){if(!outcome?.link)return;try{await navigator.clipboard.writeText(outcome.link);setCopied(true)}catch{setCopied(false)}}
  return <div className="card">
    <div className="section-head"><div><h2>Équipe & rôles</h2><p className="muted">Les administrateurs gèrent la configuration, les éditeurs préparent les données, les consultants consultent.</p></div></div>
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}
    {outcome&&<div className={outcome.delivery==='EMAIL_SENT'?'notice success':'notice warning'} data-outcome={outcome.delivery}>
      {outcome.delivery==='EMAIL_SENT'
        ?<span><strong>{outcome.kind==='reset'?'Mot de passe réinitialisé.':'Invitation envoyée.'}</strong> <span>Un email a été envoyé à</span> <span>{outcome.email}</span><span>. Le lien est valable jusqu’au</span> <span>{fmt(outcome.expiresAt)}</span>.</span>
        :<div className="stack" style={{width:'100%'}}>
          <span><strong>{outcome.kind==='reset'?'Mot de passe réinitialisé.':'Compte créé.'}</strong> <span>{outcome.reason}</span></span>
          <span>Transmettez vous-même ce lien à la personne. Il est personnel, utilisable une seule fois et ne sera plus affiché.</span>
          <div className="actions"><input readOnly value={outcome.link||''} aria-label="Lien d’accès" onFocus={e=>e.currentTarget.select()} style={{flex:1,minWidth:0}}/><button type="button" className="btn secondary" onClick={copy}><Copy size={15}/>{copied?'Copié':'Copier le lien'}</button></div>
          <small><span>Valable jusqu’au</span> <span>{fmt(outcome.expiresAt)}</span></small>
        </div>}
    </div>}
    <form onSubmit={invite} className="stack">
      <div className="form-grid"><label>Nom<input name="displayName" required maxLength={120}/></label><label>Email<input name="email" type="email" required/></label></div>
      <div className="form-grid"><label>Rôle<select name="role" defaultValue="USER"><option value="ADMIN">Administrateur</option><option value="EDITOR">Éditeur</option><option value="USER">Consultant</option></select></label></div>
      <p className="muted">La personne reçoit un lien pour choisir elle-même son mot de passe. Vous ne définissez aucun mot de passe.</p>
      <button className="btn" disabled={busy}><UserPlus size={16}/>{busy?'Envoi...':'Inviter un utilisateur'}</button>
    </form>
    <div className="stack" style={{marginTop:18}}>
      {rows.map(u=><div className="integration" key={u.id} data-user={u.email}>
        <div><strong>{u.displayName||u.email}</strong>{u.id===me&&<span className="badge" style={{marginLeft:8}}>Vous</span>}<p>{u.email}</p></div>
        <div className="actions">
          {statusBadge(u)}
          <select value={u.role} disabled={u.id===me} aria-label="Rôle" onChange={e=>role(u.id,e.target.value)}><option value="ADMIN">Administrateur</option><option value="EDITOR">Éditeur</option><option value="USER">Consultant</option></select>
          {u.status!=='ACTIVE'&&<button type="button" className="btn secondary compact" disabled={busy} onClick={()=>resend(u)}><Send size={14}/>Renvoyer le lien</button>}
          {u.status==='ACTIVE'&&u.id!==me&&<button type="button" className="btn secondary compact" disabled={busy} onClick={()=>setConfirm({kind:'reset',user:u})}><KeyRound size={14}/>Réinitialiser le mot de passe</button>}
          {u.id!==me&&<button type="button" className="icon-btn" title="Supprimer" aria-label="Supprimer" onClick={()=>setConfirm({kind:'remove',user:u})}><Trash2 size={15}/></button>}
        </div>
      </div>)}
      {rows.length===0&&<div className="muted">Aucun utilisateur.</div>}
    </div>
    {confirm&&<div className="modal-backdrop"><div className="modal confirm-modal" role="dialog" aria-modal="true">
      <div className="modal-head"><div><div className="eyebrow">Équipe</div><h2>{confirm.kind==='reset'?'Réinitialiser le mot de passe ?':'Supprimer cet utilisateur ?'}</h2></div><button className="icon-btn" onClick={()=>setConfirm(null)}>×</button></div>
      <p><strong>{confirm.user.displayName||confirm.user.email}</strong> · <span>{confirm.user.email}</span></p>
      {confirm.kind==='reset'
        ?<p>Son mot de passe actuel cessera de fonctionner et toutes ses sessions seront fermées. La personne recevra un lien pour choisir un nouveau mot de passe.</p>
        :<p>Son accès sera coupé immédiatement et son compte supprimé. L’historique de ses actions est conservé.</p>}
      <div className="wizard-actions"><button type="button" className="btn secondary" onClick={()=>setConfirm(null)}>Annuler</button>{confirm.kind==='reset'?<button type="button" className="btn" onClick={()=>reset(confirm.user)}><KeyRound size={15}/>Réinitialiser</button>:<button type="button" className="btn danger" onClick={()=>remove(confirm.user)}><Trash2 size={15}/>Supprimer</button>}</div>
    </div></div>}
  </div>
}
