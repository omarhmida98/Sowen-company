'use client';

import {useEffect,useState} from 'react';
import {Camera,CheckCircle2,FileCheck2,XCircle} from 'lucide-react';
import {api,statusLabel,docTypeLabel} from '@/lib/api';

type E={
  id:string;type:string;note?:string|null;createdAt:string;reviewStatus?:'PENDING'|'APPROVED'|'REJECTED';reviewNote?:string|null;submittedByCompany?:boolean;
  document?:{name:string;mimeType?:string|null}|null
};

export function EvidenceManager({observationId}:{observationId:string}){
  const [rows,setRows]=useState<E[]>([]),[file,setFile]=useState<File|null>(null),[type,setType]=useState('PHOTO'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false);
  const load=()=>api<E[]>(`/evidence?observationId=${observationId}`).then(setRows).catch(()=>{});
  useEffect(()=>{load()},[observationId]);

  async function upload(){
    if(!file)return;setBusy(true);setMsg('');
    const f=new FormData();f.append('file',file);
    try{
      await api(`/evidence/upload?observationId=${observationId}&type=${type}&note=${encodeURIComponent(note)}`,{method:'POST',body:f});
      setFile(null);setNote('');await load();setMsg('Preuve ajoutée.');setIsErr(false);
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }

  async function review(id:string,status:'APPROVED'|'REJECTED'){
    const reason=status==='REJECTED'?prompt('Motif du refus (optionnel) :')||undefined:undefined;
    setBusy(true);setMsg('');
    try{
      await api(`/evidence/${id}/review`,{method:'PATCH',body:JSON.stringify({status,note:reason})});
      await load();setMsg(status==='APPROVED'?'Preuve validée.':'Preuve refusée et observation remise à relancer.');setIsErr(false);
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }

  return <div className="card">
    <div className="section-head"><div><h3>Preuves & justificatifs</h3><p className="muted">Photos avant/après, PV, certificats, fiches techniques et notes vocales.</p></div></div>
    <div className="form-grid">
      <label>Type<select value={type} onChange={e=>setType(e.target.value)}><option value="BEFORE">Photo avant</option><option value="AFTER">Photo après</option><option value="PHOTO">Photo</option><option value="PV">PV</option><option value="CERTIFICATE">Certificat</option><option value="TECHNICAL_SHEET">Fiche technique</option><option value="VOICE_NOTE">Note vocale</option><option value="OTHER">Autre</option></select></label>
      <label>Fichier<input type="file" accept="image/*,application/pdf,audio/*" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
    </div>
    <label>Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Commentaire optionnel"/></label>
    <button className="btn" disabled={!file||busy} onClick={upload}><Camera size={16}/>{busy?'Envoi...':'Ajouter une preuve'}</button>
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}

    <div className="stack" style={{marginTop:14}}>
      {rows.map(r=><div className="integration" key={r.id}>
        <div className="actions"><FileCheck2 size={17}/><div><strong>{r.document?.name||docTypeLabel(r.type)}</strong><p>{docTypeLabel(r.type)}{r.note?` · ${r.note}`:''}{r.submittedByCompany?' · envoyé par l’entreprise':''}</p>{r.reviewNote&&<p className="muted">Avis : {r.reviewNote}</p>}</div></div>
        <div className="actions">
          <span className={`badge ${r.reviewStatus==='APPROVED'?'green':r.reviewStatus==='REJECTED'?'red':'yellow'}`}>{statusLabel(r.reviewStatus)}</span>
          {(r.reviewStatus||'PENDING')==='PENDING'&&<><button className="icon-btn" disabled={busy} title="Valider" onClick={()=>review(r.id,'APPROVED')}><CheckCircle2 size={16}/></button><button className="icon-btn" disabled={busy} title="Refuser" onClick={()=>review(r.id,'REJECTED')}><XCircle size={16}/></button></>}
        </div>
      </div>)}
      {rows.length===0&&<div className="muted">Aucune preuve.</div>}
    </div>
  </div>
}
