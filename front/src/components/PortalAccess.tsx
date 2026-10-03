'use client';
import {useEffect,useState} from 'react';
import {Copy,Link2,RefreshCw,ShieldOff} from 'lucide-react';
import {api} from '@/lib/api';
import {useSession} from '@/lib/session';

type Access={id:string;createdAt:string;expiresAt?:string|null;revokedAt?:string|null;createdBy?:string|null;state:'ACTIVE'|'EXPIRED'|'REVOKED';link?:string|null};
const fmt=(d?:string|null)=>d?new Intl.DateTimeFormat('fr-FR').format(new Date(d)):'—';

// Portal access of one company on one project: its state, its link, and the actions to revoke or regenerate it.
// Only administrators and editors see it; for other roles nothing is rendered and nothing is requested.
export function PortalAccess({projectId,companyId,title=true}:{projectId:string;companyId:string;title?:boolean}){
  const {role,can}=useSession();const allowed=can('portal.manage');
  const [rows,setRows]=useState<Access[]|null>(null),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[copied,setCopied]=useState(false),[confirm,setConfirm]=useState<'revoke'|'regenerate'|null>(null);
  const load=()=>api<Access[]>(`/portal/access?projectId=${projectId}&companyId=${companyId}`).then(setRows).catch((e:any)=>{setMsg(e.message);setIsErr(true)});
  useEffect(()=>{if(allowed)load()},[allowed,projectId,companyId]);
  if(!role||!allowed)return null;
  const active=rows?.find(r=>r.state==='ACTIVE')||null;const last=rows?.[0]||null;
  async function run(action:()=>Promise<unknown>,done:string){setConfirm(null);setBusy(true);setMsg('');setIsErr(false);setCopied(false);try{await action();await load();setMsg(done)}catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}}
  const create=()=>run(()=>api('/portal/access',{method:'POST',body:JSON.stringify({companyId,projectId})}),'Accès portail créé.');
  const revoke=()=>active&&run(()=>api(`/portal/access/${active.id}`,{method:'DELETE'}),'Accès révoqué : le lien ne fonctionne plus.');
  const regenerate=()=>active&&run(()=>api(`/portal/access/${active.id}/regenerate`,{method:'POST'}),'Nouveau lien créé : l’ancien ne fonctionne plus.');
  async function copy(){if(!active?.link)return;try{await navigator.clipboard.writeText(active.link);setCopied(true)}catch{setCopied(false)}}
  return <div className="portal-access" data-portal-state={active?'ACTIVE':last?.state||'NONE'}>
    {title&&<h3>Portail entreprise</h3>}
    {rows===null?<p className="muted">Chargement…</p>:active?<>
      <div className="badges"><span className="badge green">Accès actif</span><span className="muted"><span>Créé le</span> {fmt(active.createdAt)}{active.createdBy?` · ${active.createdBy}`:''}</span></div>
      <div className="kv"><span>Expire le</span><strong>{active.expiresAt?fmt(active.expiresAt):'Sans expiration'}</strong></div>
      {active.link&&<div className="actions"><input readOnly value={active.link} aria-label="Lien du portail" onFocus={e=>e.currentTarget.select()} style={{flex:1,minWidth:0}}/><button type="button" className="btn secondary compact" onClick={copy}><Copy size={14}/>{copied?'Copié':'Copier le lien'}</button></div>}
      <div className="actions" style={{marginTop:8}}><button type="button" className="btn secondary compact" disabled={busy} onClick={()=>setConfirm('regenerate')}><RefreshCw size={14}/>Régénérer</button><button type="button" className="btn secondary compact" disabled={busy} onClick={()=>setConfirm('revoke')}><ShieldOff size={14}/>Révoquer</button></div>
    </>:<>
      <div className="badges">{last?<span className="badge red">{last.state==='REVOKED'?'Accès révoqué':'Accès expiré'}</span>:<span className="badge">Aucun accès</span>}{last&&<span className="muted">{last.state==='REVOKED'?fmt(last.revokedAt):fmt(last.expiresAt)}</span>}</div>
      <p className="muted">L’entreprise ne peut pas répondre en ligne tant qu’elle n’a pas d’accès actif. Un accès est créé automatiquement à l’envoi d’une observation.</p>
      <button type="button" className="btn secondary compact" disabled={busy} onClick={create}><Link2 size={14}/>{busy?'Création...':'Créer un accès portail'}</button>
    </>}
    {msg&&<div className={isErr?'notice error':'notice'} style={{marginTop:8}}>{msg}</div>}
    {confirm&&<div className="modal-backdrop"><div className="modal confirm-modal" role="dialog" aria-modal="true">
      <div className="modal-head"><div><div className="eyebrow">Portail entreprise</div><h2>{confirm==='revoke'?'Révoquer cet accès ?':'Régénérer le lien ?'}</h2></div><button className="icon-btn" onClick={()=>setConfirm(null)}>×</button></div>
      <p>{confirm==='revoke'?'Le lien cessera de fonctionner immédiatement. L’entreprise ne pourra plus consulter ses observations ni répondre en ligne.':'Un nouveau lien est créé et l’ancien cesse de fonctionner immédiatement. Pensez à transmettre le nouveau lien à l’entreprise.'}</p>
      <div className="wizard-actions"><button type="button" className="btn secondary" onClick={()=>setConfirm(null)}>Annuler</button>{confirm==='revoke'?<button type="button" className="btn danger" onClick={revoke}><ShieldOff size={15}/>Révoquer l’accès</button>:<button type="button" className="btn" onClick={regenerate}><RefreshCw size={15}/>Régénérer le lien</button>}</div>
    </div></div>}
  </div>
}
