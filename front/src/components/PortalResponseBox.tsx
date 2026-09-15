'use client';
import {useState} from 'react';
import {MessageSquareText} from 'lucide-react';
export function PortalResponseBox({token,observationId}:{token:string;observationId:string}){
  const [note,setNote]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState('');
  async function send(){if(!note.trim())return;setBusy(true);setMsg('');try{const base=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000/api';const res=await fetch(`${base}/portal/${encodeURIComponent(token)}/response`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observationId,note})});if(!res.ok)throw new Error(await res.text());setNote('');setMsg('Réponse transmise à l’équipe projet.')}catch(e:any){setMsg(e.message)}finally{setBusy(false)}}
  return <div className="card"><h3>Répondre à l’équipe projet</h3><p className="muted">Ajoutez une explication, une date prévue d’intervention ou toute information utile.</p><textarea rows={4} value={note} onChange={e=>setNote(e.target.value)} placeholder="Votre réponse…"/><button className="btn" onClick={send} disabled={busy||!note.trim()}><MessageSquareText size={16}/>{busy?'Envoi…':'Envoyer la réponse'}</button>{msg&&<div className="notice" style={{marginTop:10}}>{msg}</div>}</div>
}
