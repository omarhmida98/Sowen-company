'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {FileSearch,Eye,RefreshCw} from 'lucide-react';
import {api,ApiProject,ApiReportFailure,analysisStatusLabel,ANALYSIS_STATUS_TONE} from '@/lib/api';
type Report={id:string;issuer?:string|null;createdAt:string;analysisStatus:string;project:{id:string;name:string};document?:{name:string}|null;_count?:{observations:number};failure?:ApiReportFailure|null};
export function ReportsManager({projectId: lockedProjectId}:{projectId?:string}){
  const router=useRouter();
  const[rows,setRows]=useState<Report[]>([]),[projects,setProjects]=useState<ApiProject[]>([]),[open,setOpen]=useState(false),[file,setFile]=useState<File|null>(null),[projectId,setProjectId]=useState(lockedProjectId||''),[issuer,setIssuer]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[retrying,setRetrying]=useState('');
  const load=async()=>{try{setRows(await api(`/reports${lockedProjectId?`?projectId=${lockedProjectId}`:''}`));if(!lockedProjectId)setProjects(await api('/projects'))}catch(e:any){setMsg(e.message);setIsErr(true)}};
  useEffect(()=>{if(lockedProjectId)setProjectId(lockedProjectId);load()},[lockedProjectId]);
  async function upload(){if(!file||!projectId)return;setBusy(true);setMsg('');const f=new FormData();f.append('file',file);try{const r:any=await api(`/reports/upload?projectId=${encodeURIComponent(projectId)}&issuer=${encodeURIComponent(issuer)}`,{method:'POST',body:f});setOpen(false);setFile(null);setIssuer('');if(!lockedProjectId)setProjectId('');await load();setMsg(`Rapport importé. ${r.createdObservations||0} observation(s) créée(s).`);setIsErr(false)}catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}}
  // Retries a failed analysis. A report that already has observations is sent to its page, where the choice is explained.
  async function retry(r:Report){if((r._count?.observations||0)>0){router.push(`/reports/${r.id}`);return}setRetrying(r.id);setMsg('');try{const res:any=await api(`/reports/${r.id}/reanalyze`,{method:'POST',body:JSON.stringify({})});await load();if(res.analysisStatus==='FAILED'){setMsg('La nouvelle analyse a échoué. Ouvrez le rapport pour voir le détail.');setIsErr(true)}else{setMsg(`Analyse terminée : ${res.createdObservations||0} observation(s) à valider.`);setIsErr(false)}}catch(e:any){setMsg(e.message);setIsErr(true)}finally{setRetrying('')}}
  return <>
    <div className="topbar">
      <div className="title"><div className="eyebrow">Bureau de Contrôle</div><h1>Rapports BC</h1><p>Les rapports importés et leurs points de contrôle.</p></div>
      <button className="btn" onClick={()=>setOpen(true)}>+ Importer un rapport</button>
    </div>
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}
    <div className="section">
      {rows.length===0
        ?<div className="card empty">Aucun rapport chargé.</div>
        :<div className="project-list">{rows.map(r=>{
          const tone=ANALYSIS_STATUS_TONE[r.analysisStatus]||'yellow';
          return <div className="card project-row report-row" key={r.id} role="link" tabIndex={0} onClick={()=>router.push(`/reports/${r.id}`)} onKeyDown={e=>{if(e.key==='Enter')router.push(`/reports/${r.id}`)}}>
            <div className="actions"><FileSearch size={20}/><div><strong>{r.document?.name||'Rapport BC'}</strong><div className="muted">{r.project.name} · {r.issuer||'Émetteur non renseigné'}</div>{r.failure&&<div className="failure-reason">{r.failure.message}</div>}</div></div>
            <div className="badges">
              <span className={`badge ${tone}`}>{analysisStatusLabel(r.analysisStatus)}</span>
              <span className="badge">{r._count?.observations||0} observation(s)</span>
              <span className="badge">{new Intl.DateTimeFormat('fr-FR').format(new Date(r.createdAt))}</span>
            </div>
            <div className="actions">{r.failure?.retryable&&<button className="btn" disabled={retrying!==''} onClick={e=>{e.stopPropagation();retry(r)}}><RefreshCw size={15}/>{retrying===r.id?'Analyse en cours…':'Relancer l’analyse'}</button>}<Link className="btn secondary" href={`/reports/${r.id}`} onClick={e=>e.stopPropagation()}><Eye size={15}/>Voir le rapport</Link></div>
          </div>;
        })}</div>}
    </div>
    {open&&<div className="modal-backdrop"><div className="modal">
      <div className="modal-head"><div><div className="eyebrow">Bureau de Contrôle</div><h2>Importer un rapport</h2></div><button className="icon-btn" onClick={()=>setOpen(false)}>×</button></div>
      {!lockedProjectId&&<label>Projet<select value={projectId} onChange={e=>setProjectId(e.target.value)}><option value="">Choisir</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
      <label>Bureau de contrôle<input value={issuer} onChange={e=>setIssuer(e.target.value)} placeholder="SOCOTEC, APAVE..."/></label>
      <label>PDF<input type="file" accept="application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/></label>
      <div className="wizard-actions"><button className="btn secondary" onClick={()=>setOpen(false)}>Annuler</button><button className="btn" disabled={!file||!projectId||busy} onClick={upload}>{busy?'Import...':'Importer et analyser'}</button></div>
    </div></div>}
  </>;
}