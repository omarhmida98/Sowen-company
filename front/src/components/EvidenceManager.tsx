'use client';

import {useEffect,useState} from 'react';
import {Camera,CheckCircle2,DownloadCloud,FileCheck2,XCircle} from 'lucide-react';
import {api,downloadFile,statusLabel,docTypeLabel} from '@/lib/api';

type E={
  id:string;type:string;note?:string|null;createdAt:string;reviewStatus?:'PENDING'|'APPROVED'|'REJECTED';reviewNote?:string|null;reviewedAt?:string|null;submittedByCompany?:boolean;
  document?:{name:string;mimeType?:string|null}|null
};
const fmt=(d?:string|null)=>d?new Intl.DateTimeFormat('fr-FR').format(new Date(d)):'—';

// Proofs attached to an observation: those the team added and those the company sent through its portal.
// readOnly: the viewer may only read and download (consultant). onChanged: a review changes the observation status.
export function EvidenceManager({observationId,readOnly=false,onChanged}:{observationId:string;readOnly?:boolean;onChanged?:()=>void}){
  const [rows,setRows]=useState<E[]>([]),[file,setFile]=useState<File|null>(null),[type,setType]=useState('PHOTO'),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[refusing,setRefusing]=useState<E|null>(null),[reason,setReason]=useState('');
  const load=()=>api<E[]>(`/evidence?observationId=${observationId}`).then(setRows).catch(()=>{});
  useEffect(()=>{load()},[observationId]);

  async function upload(){
    if(!file)return;setBusy(true);setMsg('');
    const f=new FormData();f.append('file',file);
    try{
      await api(`/evidence/upload?observationId=${observationId}&type=${type}&note=${encodeURIComponent(note)}`,{method:'POST',body:f});
      setFile(null);setNote('');await load();setMsg('Preuve ajoutée.');setIsErr(false);onChanged?.();
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }

  async function review(r:E,status:'APPROVED'|'REJECTED',why?:string){
    setBusy(true);setMsg('');
    try{
      await api(`/evidence/${r.id}/review`,{method:'PATCH',body:JSON.stringify({status,note:why})});
      setRefusing(null);setReason('');await load();
      setMsg(status==='APPROVED'?'Justificatif validé. L’observation reste ouverte tant que vous ne la clôturez pas.':'Justificatif refusé : l’entreprise voit le motif et l’observation repasse à relancer.');setIsErr(false);onChanged?.();
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }

  async function download(r:E){setMsg('');try{await downloadFile(`/evidence/${r.id}/file`,r.document?.name||'justificatif')}catch(e:any){setMsg(e.message);setIsErr(true)}}

  return <div className="card" id="evidence">
    <div className="section-head"><div><h3>Preuves & justificatifs</h3><p className="muted">Photos avant/après, PV, certificats, fiches techniques et notes vocales.</p></div></div>
    {!readOnly&&<><div className="form-grid">
      <label>Type<select value={type} onChange={e=>setType(e.target.value)}><option value="BEFORE">Photo avant</option><option value="AFTER">Photo après</option><option value="PHOTO">Photo</option><option value="PV">PV</option><option value="CERTIFICATE">Certificat</option><option value="TECHNICAL_SHEET">Fiche technique</option><option value="VOICE_NOTE">Note vocale</option><option value="OTHER">Autre</option></select></label>
      <label>Fichier<input type="file" accept="image/*,application/pdf,audio/*" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
    </div>
    <label>Note<input value={note} onChange={e=>setNote(e.target.value)} placeholder="Commentaire optionnel"/></label>
    <button className="btn" disabled={!file||busy} onClick={upload}><Camera size={16}/>{busy?'Envoi...':'Ajouter une preuve'}</button></>}
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}

    <div className="stack" style={{marginTop:14}}>
      {rows.map(r=><div className="integration evidence-row" key={r.id} data-evidence={r.reviewStatus||'PENDING'}>
        <div className="actions"><FileCheck2 size={17}/><div>
          <strong>{r.document?.name||docTypeLabel(r.type)}</strong>
          <p>{docTypeLabel(r.type)}{r.note?` · ${r.note}`:''} · {fmt(r.createdAt)}</p>
          <div className="badges">{r.submittedByCompany?<span className="badge blue">Envoyé par l’entreprise</span>:<span className="badge">Ajouté par l’équipe</span>}</div>
          {r.reviewStatus==='REJECTED'&&r.reviewNote&&<p className="refusal"><span>Motif du refus :</span> <span>{r.reviewNote}</span></p>}
        </div></div>
        <div className="actions">
          {r.document&&<button className="icon-btn" title="Télécharger" aria-label="Télécharger" onClick={()=>download(r)}><DownloadCloud size={16}/></button>}
          <span className={`badge ${r.reviewStatus==='APPROVED'?'green':r.reviewStatus==='REJECTED'?'red':'yellow'}`}>{r.reviewStatus==='APPROVED'?'Validé':r.reviewStatus==='REJECTED'?'Refusé':'À examiner'}</span>
          {!readOnly&&(r.reviewStatus||'PENDING')==='PENDING'&&<><button className="icon-btn" disabled={busy} title="Valider" aria-label="Valider" onClick={()=>review(r,'APPROVED')}><CheckCircle2 size={16}/></button><button className="icon-btn" disabled={busy} title="Refuser" aria-label="Refuser" onClick={()=>{setReason('');setRefusing(r)}}><XCircle size={16}/></button></>}
        </div>
      </div>)}
      {rows.length===0&&<div className="muted">Aucune preuve.</div>}
    </div>

    {refusing&&<div className="modal-backdrop"><div className="modal confirm-modal" role="dialog" aria-modal="true">
      <div className="modal-head"><div><div className="eyebrow">Justificatif</div><h2>Refuser ce justificatif ?</h2></div><button className="icon-btn" onClick={()=>setRefusing(null)}>×</button></div>
      <p><strong>{refusing.document?.name||docTypeLabel(refusing.type)}</strong></p>
      <label>Motif du refus<textarea rows={3} value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} autoFocus placeholder="Ce qui manque ou ne convient pas"/></label>
      <p className="muted">Le motif est enregistré et affiché à l’entreprise sur son portail. Elle pourra envoyer un nouveau justificatif.</p>
      <div className="wizard-actions"><button type="button" className="btn secondary" onClick={()=>setRefusing(null)}>Annuler</button><button type="button" className="btn danger" disabled={busy||!reason.trim()} onClick={()=>review(refusing,'REJECTED',reason.trim())}><XCircle size={15}/>Refuser le justificatif</button></div>
    </div></div>}
  </div>
}
