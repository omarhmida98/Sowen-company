'use client';
import {useState} from 'react';
import {MessageSquareText} from 'lucide-react';
import {api} from '@/lib/api';

export type CompanyResponse={id:string;source:'PORTAL'|'INTERNAL';message:string;createdAt:string;author?:string|null};
const fmt=(d:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(d));

// What the company answered about this observation. A response is never edited: it comes either from the company
// portal or from a member of the team who recorded an answer received elsewhere.
export function CompanyResponses({observationId,responses,companyName,canWrite,closed,onChanged}:{observationId:string;responses:CompanyResponse[];companyName?:string|null;canWrite:boolean;closed:boolean;onChanged:()=>void}){
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  async function add(){
    if(!message.trim())return;setBusy(true);setErr('');
    try{await api(`/observations/${observationId}/responses`,{method:'POST',body:JSON.stringify({message:message.trim()})});setMessage('');onChanged()}
    catch(e:any){setErr(e.message)}finally{setBusy(false)}
  }
  return <div className="card" id="responses">
    <div className="section-head"><div><h3>Réponses de l’entreprise</h3><p className="muted">{companyName||'Entreprise non affectée'}</p></div></div>
    <div className="stack">
      {responses.map(r=><div className="response" key={r.id} data-source={r.source}>
        <div className="badges">{r.source==='PORTAL'?<span className="badge blue">Reçue via le portail</span>:<span className="badge">Saisie par l’équipe</span>}<span className="muted">{fmt(r.createdAt)}{r.source==='INTERNAL'&&r.author?` · ${r.author}`:''}</span></div>
        <p>{r.message}</p>
      </div>)}
      {responses.length===0&&<div className="muted">Aucune réponse de l’entreprise pour le moment.</div>}
    </div>
    {canWrite&&!closed&&<div style={{marginTop:14}}>
      <label>Enregistrer une réponse reçue autrement (téléphone, email, visite)<textarea rows={3} value={message} maxLength={4000} onChange={e=>setMessage(e.target.value)} placeholder="Ce que l’entreprise a répondu…"/></label>
      {err&&<div className="notice error">{err}</div>}
      <button className="btn secondary" disabled={busy||!message.trim()} onClick={add}><MessageSquareText size={16}/>{busy?'Enregistrement...':'Enregistrer la réponse'}</button>
    </div>}
  </div>
}
