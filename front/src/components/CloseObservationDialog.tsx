'use client';
import {useEffect,useState} from 'react';
import {CheckCircle2} from 'lucide-react';
import {api} from '@/lib/api';

type Evidence={id:string;reviewStatus?:'PENDING'|'APPROVED'|'REJECTED'};

// Closing an observation is an explicit decision: it needs an approved proof, or a confirmation that none is required.
// Proofs still waiting for a decision must be reviewed first. The API applies the same rule.
export function CloseObservationDialog({observationId,title,onClose,onClosed}:{observationId:string;title:string;onClose:()=>void;onClosed:()=>void}){
  const [rows,setRows]=useState<Evidence[]|null>(null),[confirm,setConfirm]=useState(false),[note,setNote]=useState(''),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{api<Evidence[]>(`/evidence?observationId=${observationId}`).then(setRows).catch((e:any)=>{setErr(e.message);setRows([])})},[observationId]);
  const approved=(rows||[]).filter(r=>r.reviewStatus==='APPROVED').length,pending=(rows||[]).filter(r=>(r.reviewStatus||'PENDING')==='PENDING').length;
  const allowed=rows!==null&&pending===0&&(approved>0||confirm);
  async function submit(){
    setBusy(true);setErr('');
    try{await api(`/observations/${observationId}/close`,{method:'POST',body:JSON.stringify({confirmWithoutProof:approved===0&&confirm,note:note.trim()||undefined})});onClosed();onClose()}
    catch(e:any){setErr(e.message);setBusy(false)}
  }
  return <div className="modal-backdrop"><div className="modal confirm-modal close-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><div className="eyebrow">Observation</div><h2>Clôturer l’observation ?</h2></div><button className="icon-btn" onClick={onClose}>×</button></div>
    <p><strong>{title}</strong></p>
    {rows===null?<p className="muted">Chargement…</p>:<>
      <div className="badges"><span className="badge green"><span>{approved}</span> <span>justificatif(s) validé(s)</span></span>{pending>0&&<span className="badge yellow"><span>{pending}</span> <span>à examiner</span></span>}</div>
      {pending>0&&<div className="notice warning">Des justificatifs attendent encore votre décision. Validez-les ou refusez-les avant de clôturer.</div>}
      {pending===0&&approved===0&&<label className="check-line"><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/><span>Aucun justificatif n’est validé : je confirme clôturer sans justificatif.</span></label>}
      {pending===0&&<label>Commentaire de clôture (facultatif)<textarea rows={2} value={note} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label>}
      <p className="muted">Les réponses de l’entreprise, les justificatifs et l’historique restent attachés à l’observation. Elle pourra être rouverte.</p>
    </>}
    {err&&<div className="notice error">{err}</div>}
    <div className="wizard-actions"><button type="button" className="btn secondary" onClick={onClose}>Annuler</button><button type="button" className="btn" disabled={!allowed||busy} onClick={submit}><CheckCircle2 size={15}/>{busy?'Clôture...':'Clôturer l’observation'}</button></div>
  </div></div>
}
