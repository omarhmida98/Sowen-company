'use client';

import {useEffect,useMemo,useRef,useState} from 'react';
import Link from 'next/link';
import {CheckCircle2, Send, TriangleAlert, X} from 'lucide-react';
import {api,ApiSendContext,severityLabel,statusLabel} from '@/lib/api';

const SEV_TONE:Record<string,string>={CRITICAL:'red',HIGH:'red',MEDIUM:'yellow',LOW:'',INFO:''};
const fmt=(d?:string|null)=>d?new Intl.DateTimeFormat('fr-FR').format(new Date(d)):'—';
const SEARCH_THRESHOLD=8;

type Props={observationId:string;onClose:()=>void;onChanged:()=>void};
type Sent={companyName:string;recipient:string;sentAt:string;projectId:string;portal?:{inEmail:boolean;link:string|null}};

export function SendObservationModal({observationId,onClose,onChanged}:Props){
  const [ctx,setCtx]=useState<ApiSendContext|null>(null);
  const [loadError,setLoadError]=useState('');
  const [companyId,setCompanyId]=useState('');
  const [subject,setSubject]=useState('');
  const [body,setBody]=useState('');
  const [edited,setEdited]=useState(false);
  const [search,setSearch]=useState('');
  const [busy,setBusy]=useState<'draft'|'send'|null>(null);
  const [msg,setMsg]=useState('');
  const [isErr,setIsErr]=useState(false);
  const [sent,setSent]=useState<Sent|null>(null);
  const [linkCopied,setLinkCopied]=useState(false);
  // Guards against a second submit before React has re-rendered the disabled button.
  const inFlight=useRef(false);

  async function load(forCompany?:string,keepText=false){
    try{
      const next=await api<ApiSendContext>(`/emails/observation/${observationId}/compose${forCompany?`?companyId=${encodeURIComponent(forCompany)}`:''}`);
      setCtx(next);
      const selected=next.companies.find(c=>c.id===next.selectedCompanyId);
      setCompanyId(selected?.email?selected.id:'');
      if(keepText)return;
      // A draft the user saved is reused, and only for the company it was written for.
      const reuse=!forCompany&&next.savedDraft?.userEdited&&selected?.email&&next.savedDraft.recipientEmail===selected.email;
      setSubject(reuse?next.savedDraft!.subject:next.draft.subject);
      setBody(reuse?next.savedDraft!.body:next.draft.body);
      setEdited(false);
    }catch(e:any){setLoadError(e.message)}
  }
  useEffect(()=>{load()},[observationId]);
  useEffect(()=>{
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busy)onClose()};
    window.addEventListener('keydown',onKey);document.body.style.overflow='hidden';
    return()=>{window.removeEventListener('keydown',onKey);document.body.style.overflow=''};
  },[busy,onClose]);

  const company=ctx?.companies.find(c=>c.id===companyId)||null;
  const matched=ctx?.companies.find(c=>c.id===ctx.selectedCompanyId)||null;
  const visibleCompanies=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return (ctx?.companies||[]).filter(c=>!q||c.id===companyId||c.name.toLowerCase().includes(q)||(c.email||'').toLowerCase().includes(q));
  },[ctx,search,companyId]);
  const alreadySentToCompany=Boolean(ctx?.lastSent&&company?.email&&ctx.lastSent.recipientEmail===company.email);

  function chooseCompany(id:string){
    setCompanyId(id);setMsg('');
    if(id)load(id,edited);
  }

  async function submit(kind:'draft'|'send'){
    if(inFlight.current||!company)return;
    inFlight.current=true;setBusy(kind);setMsg('');setIsErr(false);
    const payload={companyId:company.id,subject,body};
    try{
      if(kind==='draft'){
        await api(`/emails/observation/${observationId}/draft`,{method:'PUT',body:JSON.stringify(payload)});
        setMsg('Brouillon enregistré.');setEdited(false);onChanged();
      }else{
        const r=await api<{email:{sentAt:string;recipientEmail:string;projectId:string};company:{name:string;email:string};portal?:{inEmail:boolean;link:string|null}}>(`/emails/observation/${observationId}/send`,{method:'POST',body:JSON.stringify({...payload,allowResend:alreadySentToCompany})});
        setSent({companyName:r.company.name,recipient:r.email.recipientEmail,sentAt:r.email.sentAt,projectId:r.email.projectId,portal:r.portal});onChanged();
      }
    }catch(e:any){setMsg(e.message);setIsErr(true);if(kind==='send')load(company.id,true)}
    finally{inFlight.current=false;setBusy(null)}
  }

  const o=ctx?.observation;
  const canSave=Boolean(company&&subject.trim()&&body.trim())&&!busy;
  const canSend=canSave&&Boolean(company?.email)&&Boolean(ctx?.emailConfigured);

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Envoyer l’observation">
    <div className="modal send-modal">
      <div className="modal-head">
        <div><div className="eyebrow">Transmission à l’entreprise</div><h2>Envoyer l’observation</h2></div>
        <button className="icon-btn" aria-label="Fermer" title="Fermer" onClick={onClose} disabled={busy!==null}><X size={16}/></button>
      </div>

      {loadError&&<div className="notice error">{loadError}</div>}
      {!ctx&&!loadError&&<div className="card empty">Chargement…</div>}

      {sent&&<div className="send-success">
        <CheckCircle2 size={34}/>
        <h3>Mail envoyé</h3>
        <p><span>Envoyé à</span> <strong>{sent.companyName}</strong> ({sent.recipient}) <span>le</span> {fmt(sent.sentAt)}</p>
        {sent.portal?.inEmail&&<p className="portal-note" data-portal="in-email">Le mail contient le bouton « Répondre dans SOWEN » : l’entreprise peut répondre et envoyer ses justificatifs en ligne.</p>}
        {sent.portal&&!sent.portal.inEmail&&sent.portal.link&&<div className="notice warning portal-note" data-portal="link-only"><span>Le mail ne contient pas de lien vers le portail : l’adresse publique de SOWEN n’est pas configurée. Transmettez ce lien à l’entreprise si besoin.</span><div className="actions" style={{width:'100%'}}><input readOnly value={sent.portal.link} aria-label="Lien du portail" onFocus={e=>e.currentTarget.select()} style={{flex:1,minWidth:0}}/><button type="button" className="btn secondary compact" onClick={()=>{navigator.clipboard?.writeText(sent.portal!.link!).then(()=>setLinkCopied(true)).catch(()=>{})}}>{linkCopied?'Copié':'Copier le lien'}</button></div></div>}
        <p className="muted">Le message est disponible dans Mails & relances et peut être relancé depuis l’observation.</p>
        <div className="wizard-actions">
          <Link className="btn secondary" href={`/projects/${sent.projectId}/mails`}>Voir dans Mails & relances</Link>
          <button className="btn" onClick={onClose}>Fermer</button>
        </div>
      </div>}

      {ctx&&o&&!sent&&<>
        <div className="send-summary">
          <div className="badges">
            <span className={`badge ${SEV_TONE[o.severity]||''}`}>{severityLabel(o.severity)}</span>
            <span className="badge yellow">{statusLabel(o.status)}</span>
            {o.sourcePage?<span className="badge">Page {o.sourcePage}</span>:null}
          </div>
          <strong>{o.title}</strong>
          {o.description!==o.title&&<p>{o.description}</p>}
          <div className="send-facts">
            <div><small>Projet</small><span>{o.project.name}</span></div>
            <div><small>Lot</small><span>{o.lot?.name||'—'}</span></div>
            <div><small>Rapport source</small><span>{o.report?(o.report.name||o.report.issuer||'Rapport BC'):'—'}</span></div>
            <div><small>Échéance</small><span>{fmt(o.dueDate)}</span></div>
          </div>
        </div>

        {ctx.lastSent&&<div className="notice"><span>Déjà envoyé à</span> <strong>{ctx.lastSent.companyName||ctx.lastSent.recipientEmail}</strong> ({ctx.lastSent.recipientEmail}) <span>le</span> {fmt(ctx.lastSent.sentAt)}</div>}
        {!ctx.emailConfigured&&<div className="notice warning"><TriangleAlert size={16}/><span>L’envoi d’emails n’est pas configuré. Vous pouvez préparer et enregistrer le brouillon ; l’envoi sera disponible une fois le service activé.</span></div>}

        {ctx.companies.length===0
          ?<div className="notice warning"><span>Aucune entreprise enregistrée.</span> <Link className="text-link" href="/companies">Ajouter une entreprise</Link></div>
          :<>
            {ctx.companies.length>SEARCH_THRESHOLD&&<label>Rechercher une entreprise<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Nom ou email"/></label>}
            <label>Entreprise destinataire
              <select value={companyId} onChange={e=>chooseCompany(e.target.value)} disabled={busy!==null}>
                <option value="">Choisir une entreprise</option>
                {visibleCompanies.map(c=><option key={c.id} value={c.id} disabled={!c.email}>{`${c.name} — ${c.email||'Email manquant'}`}</option>)}
              </select>
            </label>
            {matched&&!matched.email&&!company&&<div className="notice warning"><span>L’entreprise affectée à cette observation n’a pas d’adresse email :</span> <strong>{matched.name}</strong>. <Link className="text-link" href={`/companies?edit=${matched.id}`}>Modifier l’entreprise</Link></div>}
            {ctx.companies.some(c=>!c.email)&&<p className="muted send-hint"><span>Les entreprises sans email ne peuvent pas être sélectionnées.</span> <Link className="text-link" href="/companies">Gérer les entreprises</Link></p>}
          </>}

        {company&&<>
          <div className="kv"><span>Destinataire</span><strong>{company.email}</strong></div>
          <label>Objet<input value={subject} maxLength={300} onChange={e=>{setSubject(e.target.value);setEdited(true)}} disabled={busy!==null}/></label>
          <label>Message<textarea rows={13} value={body} onChange={e=>{setBody(e.target.value);setEdited(true)}} disabled={busy!==null}/></label>
          {edited&&<button type="button" className="btn secondary compact" disabled={busy!==null} onClick={()=>{setSubject(ctx.draft.subject);setBody(ctx.draft.body);setEdited(false)}}>Régénérer le brouillon</button>}
        </>}

        {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}

        <div className="wizard-actions">
          <button type="button" className="btn secondary" onClick={onClose} disabled={busy!==null}>Annuler</button>
          <button type="button" className="btn secondary" onClick={()=>submit('draft')} disabled={!canSave}>{busy==='draft'?'Enregistrement...':'Enregistrer le brouillon'}</button>
          <button type="button" className="btn" onClick={()=>submit('send')} disabled={!canSend} title={ctx.emailConfigured?undefined:'Envoi indisponible : service email non configuré'}><Send size={15}/>{busy==='send'?'Envoi...':alreadySentToCompany?'Envoyer à nouveau':'Envoyer'}</button>
        </div>
      </>}
    </div>
  </div>
}
