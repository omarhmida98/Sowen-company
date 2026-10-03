'use client';
import {useEffect,useState} from 'react';
import {api,ApiCompany,ApiLot,ApiObservation} from '@/lib/api';

type Props={observation:ApiObservation;onClose:()=>void;onSaved:()=>void};

// Edits the content of an observation. The API records what changed in the observation history.
export function EditObservationModal({observation:o,onClose,onSaved}:Props){
  const [companies,setCompanies]=useState<ApiCompany[]>([]),[lots,setLots]=useState<ApiLot[]>([]),[busy,setBusy]=useState(false),[err,setErr]=useState('');
  useEffect(()=>{Promise.all([api<ApiCompany[]>('/companies'),api<ApiLot[]>('/lots')]).then(([c,l])=>{setCompanies(c);setLots(l)}).catch(e=>setErr(e.message))},[]);
  async function submit(e:any){
    e.preventDefault();setBusy(true);setErr('');
    const f=new FormData(e.currentTarget as HTMLFormElement);
    // An emptied optional field is sent as null so that it is cleared.
    const body={title:f.get('title'),description:f.get('description'),reference:f.get('reference')||null,requiredAction:f.get('requiredAction')||null,severity:f.get('severity'),dueDate:f.get('dueDate')||null,lotId:f.get('lotId')||null,companyId:f.get('companyId')||null};
    try{await api(`/observations/${o.id}`,{method:'PATCH',body:JSON.stringify(body)});onSaved();onClose()}
    catch(e:any){setErr(e.message)}finally{setBusy(false)}
  }
  // The lot and company selects are rendered once their options are loaded, so the current value is selected.
  const ready=lots.length>0||companies.length>0||!!err;
  return <div className="modal-backdrop"><div className="modal">
    <div className="modal-head"><div><div className="eyebrow">Observation</div><h2>Modifier l’observation</h2></div><button className="icon-btn" onClick={onClose}>×</button></div>
    {err&&<div className="notice error">{err}</div>}
    <form onSubmit={submit}>
      <label>Titre<input name="title" required defaultValue={o.title||''}/></label>
      <label>Description<textarea name="description" required rows={4} defaultValue={o.description||''}/></label>
      {ready&&<div className="form-grid">
        <label>Lot<select name="lotId" defaultValue={o.lot?.id||''}><option value="">Non défini</option>{lots.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
        <label>Entreprise<select name="companyId" defaultValue={o.company?.id||''}><option value="">Non définie</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
        <label>Sévérité<select name="severity" defaultValue={o.severity}><option value="INFO">Information</option><option value="LOW">Faible</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Élevée</option><option value="CRITICAL">Critique</option></select></label>
        <label>Échéance<input type="date" name="dueDate" defaultValue={o.dueDate?o.dueDate.slice(0,10):''}/></label>
      </div>}
      <label>Référence<input name="reference" defaultValue={o.reference||''}/></label>
      <label>Action attendue<textarea name="requiredAction" rows={3} defaultValue={o.requiredAction||''}/></label>
      <p className="muted">Chaque modification est enregistrée dans l’historique de l’observation.</p>
      <div className="wizard-actions"><button type="button" className="btn secondary" onClick={onClose}>Annuler</button><button className="btn" disabled={busy||!ready}>{busy?'Enregistrement...':'Enregistrer'}</button></div>
    </form>
  </div></div>;
}
