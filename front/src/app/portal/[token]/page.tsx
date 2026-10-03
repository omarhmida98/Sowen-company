'use client';
import {useCallback,useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import {Camera,DownloadCloud,FileCheck2,MessageSquareText} from 'lucide-react';
import {severityLabel,docTypeLabel} from '@/lib/api';
import {PreferenceControls} from '@/components/Preferences';

// The company portal: reached with a signed link, without any SOWEN account. It only ever talks to /portal/<link>.
const API=process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000/api';
type Evidence={id:string;type:string;note?:string|null;createdAt:string;reviewStatus:'PENDING'|'APPROVED'|'REJECTED';reviewNote?:string|null;fileName?:string|null};
type Observation={id:string;title:string;description:string;requiredAction?:string|null;severity:string;reference?:string|null;lot?:string|null;dueDate?:string|null;status:'ACTION_REQUIRED'|'UNDER_REVIEW'|'CLOSED';closedAt?:string|null;responses:{id:string;message:string;createdAt:string}[];evidence:Evidence[]};
type Portal={access:{organization:string;project:{name:string;address?:string|null};company:{name:string};expiresAt?:string|null};observations:Observation[]};
const fmt=(d?:string|null)=>d?new Intl.DateTimeFormat('fr-FR').format(new Date(d)):'—';
const fmtTime=(d:string)=>new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(d));
const SEV_TONE:Record<string,string>={CRITICAL:'red',HIGH:'red',MEDIUM:'yellow',LOW:'',INFO:''};
const STATUS:Record<Observation['status'],{label:string;tone:string}>={ACTION_REQUIRED:{label:'Réponse attendue',tone:'yellow'},UNDER_REVIEW:{label:'Réponse reçue — en cours d’examen',tone:'blue'},CLOSED:{label:'Clôturée',tone:'green'}};
const FAILED='L’envoi a échoué. Réessayez dans un instant.';

async function request(path:string,init?:RequestInit){
  const res=await fetch(`${API}${path}`,{...init,headers:{...(init?.headers||{}),'ngrok-skip-browser-warning':'true'},cache:'no-store'});
  if(!res.ok){let message='';try{message=(await res.json()).message}catch{}throw new Error(typeof message==='string'&&message&&message.length<200&&res.status!==500?message:FAILED)}
  return res;
}

export default function PortalPage(){
  const {token}=useParams<{token:string}>();const link=encodeURIComponent(token);
  const [data,setData]=useState<Portal|null>(null),[state,setState]=useState<'loading'|'ready'|'invalid'>('loading');
  const load=useCallback(()=>request(`/portal/${link}`).then(r=>r.json()).then(d=>{setData(d);setState('ready')}).catch(()=>setState('invalid')),[link]);
  useEffect(()=>{load()},[load]);
  return <main className="main portal">
    <meta name="referrer" content="no-referrer"/>
    <div className="portal-tools"><PreferenceControls/></div>
    {state==='loading'&&<div className="card empty">Chargement…</div>}
    {state==='invalid'&&<div className="card"><h1>Lien invalide</h1><p className="muted">Ce lien est invalide, expiré ou révoqué. Demandez un nouveau lien à votre interlocuteur sur le projet.</p></div>}
    {state==='ready'&&data&&<>
      <div className="topbar"><div className="title"><div className="eyebrow">Portail entreprise sécurisé · {data.access.organization}</div><h1>{data.access.company.name}</h1><p><span>Projet :</span> <strong>{data.access.project.name}</strong>{data.access.project.address?` · ${data.access.project.address}`:''}</p></div></div>
      <div className="notice">Ce lien est personnel : il donne accès uniquement aux observations adressées à votre entreprise pour ce projet. Ne le transférez pas.</div>
      <div className="project-list section">
        {data.observations.map(o=><ObservationCard key={o.id} link={link} o={o} onChanged={load}/>)}
        {data.observations.length===0&&<div className="card empty">Aucune observation ne vous a été transmise pour ce projet.</div>}
      </div>
    </>}
  </main>
}

function ObservationCard({link,o,onChanged}:{link:string;o:Observation;onChanged:()=>void}){
  const closed=o.status==='CLOSED';
  const [message,setMessage]=useState(''),[file,setFile]=useState<File|null>(null),[type,setType]=useState('PHOTO'),[note,setNote]=useState(''),[busy,setBusy]=useState(''),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[fileKey,setFileKey]=useState(0);
  const refused=o.evidence.filter(e=>e.reviewStatus==='REJECTED');
  async function run(kind:string,action:()=>Promise<unknown>,done:string){setBusy(kind);setMsg('');setIsErr(false);try{await action();setMsg(done);onChanged()}catch(e:any){setMsg(e.message||FAILED);setIsErr(true)}finally{setBusy('')}}
  const respond=()=>run('response',async()=>{await request(`/portal/${link}/response`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({observationId:o.id,message:message.trim()})});setMessage('')},'Réponse transmise à l’équipe projet.');
  const upload=()=>run('evidence',async()=>{const form=new FormData();form.append('file',file as File);await request(`/portal/${link}/evidence?observationId=${encodeURIComponent(o.id)}&type=${encodeURIComponent(type)}&note=${encodeURIComponent(note)}`,{method:'POST',body:form});setFile(null);setNote('');setFileKey(k=>k+1)},'Justificatif envoyé à l’équipe projet.');
  async function download(e:Evidence){setMsg('');try{const res=await request(`/portal/${link}/evidence/${e.id}/file`);const url=URL.createObjectURL(await res.blob());const a=document.createElement('a');a.href=url;a.download=e.fileName||'justificatif';a.click();URL.revokeObjectURL(url)}catch{setMsg('Téléchargement impossible.');setIsErr(true)}}
  return <div className="card portal-observation" data-status={o.status}>
    <div className="badges"><span className={`badge ${STATUS[o.status].tone}`}>{STATUS[o.status].label}</span><span className={`badge ${SEV_TONE[o.severity]||''}`}>{severityLabel(o.severity)}</span>{o.lot&&<span className="badge">{o.lot}</span>}</div>
    <h2>{o.title}</h2>
    {o.description!==o.title&&<p>{o.description}</p>}
    <div className="detail-grid">
      <div className="detail-block"><small>Action attendue</small><p>{o.requiredAction||'Non précisée'}</p></div>
      <div className="detail-block"><small>Référence</small><p>{o.reference||'—'}</p></div>
      <div className="detail-block"><small>Échéance</small><p>{fmt(o.dueDate)}</p></div>
      {closed&&<div className="detail-block"><small>Clôturée le</small><p>{fmt(o.closedAt)}</p></div>}
    </div>
    {refused.length>0&&!closed&&<div className="notice warning"><strong>Un justificatif a été refusé.</strong> <span>Consultez le motif ci-dessous et envoyez un nouveau justificatif.</span></div>}

    <h3>Vos réponses</h3>
    <div className="stack">
      {o.responses.map(r=><div className="response" key={r.id}><span className="muted">{fmtTime(r.createdAt)}</span><p>{r.message}</p></div>)}
      {o.responses.length===0&&<div className="muted">Vous n’avez pas encore répondu.</div>}
    </div>
    {!closed&&<><label>Répondre à l’équipe projet<textarea rows={3} value={message} maxLength={4000} onChange={e=>setMessage(e.target.value)} placeholder="Explication, date d’intervention prévue, information utile…"/></label>
    <button className="btn" onClick={respond} disabled={busy!==''||!message.trim()}><MessageSquareText size={16}/>{busy==='response'?'Envoi…':'Envoyer la réponse'}</button></>}

    <h3>Vos justificatifs</h3>
    <div className="stack">
      {o.evidence.map(e=><div className="integration evidence-row" key={e.id} data-evidence={e.reviewStatus}>
        <div className="actions"><FileCheck2 size={17}/><div><strong>{e.fileName||docTypeLabel(e.type)}</strong><p>{docTypeLabel(e.type)}{e.note?` · ${e.note}`:''} · {fmt(e.createdAt)}</p>{e.reviewStatus==='REJECTED'&&<p className="refusal"><span>Motif du refus :</span> <span>{e.reviewNote||'—'}</span></p>}</div></div>
        <div className="actions"><button className="icon-btn" title="Télécharger" aria-label="Télécharger" onClick={()=>download(e)}><DownloadCloud size={16}/></button><span className={`badge ${e.reviewStatus==='APPROVED'?'green':e.reviewStatus==='REJECTED'?'red':'yellow'}`}>{e.reviewStatus==='APPROVED'?'Validé':e.reviewStatus==='REJECTED'?'Refusé':'En cours d’examen'}</span></div>
      </div>)}
      {o.evidence.length===0&&<div className="muted">Aucun justificatif envoyé.</div>}
    </div>
    {!closed&&<><div className="form-grid">
      <label>Type<select value={type} onChange={e=>setType(e.target.value)}><option value="BEFORE">Photo avant</option><option value="AFTER">Photo après</option><option value="PHOTO">Photo</option><option value="PV">PV</option><option value="CERTIFICATE">Certificat</option><option value="TECHNICAL_SHEET">Fiche technique</option><option value="VOICE_NOTE">Note vocale</option><option value="OTHER">Autre</option></select></label>
      <label>Fichier<input key={fileKey} type="file" accept="image/*,application/pdf,audio/*" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
    </div>
    <label>Commentaire<input value={note} maxLength={500} onChange={e=>setNote(e.target.value)} placeholder="Commentaire optionnel"/></label>
    <button className="btn secondary" disabled={!file||busy!==''} onClick={upload}><Camera size={16}/>{busy==='evidence'?'Envoi...':'Envoyer le justificatif'}</button></>}
    {closed&&<p className="muted">Cette observation est clôturée : elle n’accepte plus de réponse ni de justificatif.</p>}
    {msg&&<div className={isErr?'notice error':'notice success'} style={{marginTop:10}} role="status">{msg}</div>}
  </div>
}
