'use client';
import {useSession} from '@/lib/session';
import {useEffect,useMemo,useState} from 'react';import Link from 'next/link';import {useRouter} from 'next/navigation';import {api,ApiCompany,ApiLot,ApiObservation,ApiProject,statusLabel,severityLabel} from '@/lib/api';
import {filterObservations,hasActiveFilters,NONE,ObservationFilters} from '@/lib/observation-filters';
const fmt=(d?:string|null)=>d?new Intl.DateTimeFormat('fr-FR').format(new Date(d)):'—';
const SEV_TONE:Record<string,string>={CRITICAL:'red',HIGH:'red',MEDIUM:'yellow',LOW:'',INFO:''};
const SEVERITIES=['CRITICAL','HIGH','MEDIUM','LOW','INFO'];
const STATUSES=['OPEN','TO_SEND','SENT','WAITING','TO_RELAUNCH','BLOCKED','RESOLVED'];
const NO_FILTERS:ObservationFilters={q:'',status:'',severity:'',lotId:'',companyId:'',review:'',sort:'newest'};
// Lots or companies that appear in the listed observations, sorted by name.
function options(rows:ApiObservation[],pick:(o:ApiObservation)=>{id:string;name:string}|null|undefined){const m=new Map<string,string>();for(const o of rows){const v=pick(o);if(v)m.set(v.id,v.name)}return [...m].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'fr'))}
export function ObservationManager({projectId,status,filter}:{projectId?:string;status?:string;filter?:string}){const {can}=useSession();
  const [rows,setRows]=useState<ApiObservation[]>([]),[projects,setProjects]=useState<ApiProject[]>([]),[companies,setCompanies]=useState<ApiCompany[]>([]),[lots,setLots]=useState<ApiLot[]>([]),[open,setOpen]=useState(false),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[busy,setBusy]=useState(false),[filters,setFilters]=useState<ObservationFilters>(NO_FILTERS);
  const load=async()=>{try{const [o,p,c,l]=await Promise.all([api<ApiObservation[]>(`/observations${projectId?`?projectId=${projectId}`:''}`),projectId?Promise.resolve([] as ApiProject[]):api<ApiProject[]>('/projects'),api<ApiCompany[]>('/companies'),api<ApiLot[]>('/lots')]);setRows(o);setProjects(p);setCompanies(c);setLots(l)}catch(e:any){setMsg(e.message);setIsErr(true)}};
  useEffect(()=>{load()},[projectId]);
  async function submit(e:any){e.preventDefault();setBusy(true);const form=e.currentTarget as HTMLFormElement;const f=new FormData(form);const body:any={projectId:projectId||f.get('projectId'),title:f.get('title'),description:f.get('description'),lotId:f.get('lotId')||undefined,companyId:f.get('companyId')||undefined,reference:f.get('reference')||undefined,requiredAction:f.get('requiredAction')||undefined,severity:f.get('severity'),dueDate:f.get('dueDate')||undefined};try{await api('/observations',{method:'POST',body:JSON.stringify(body)});form.reset();setOpen(false);await load();setMsg('Observation créée et brouillon email généré.');setIsErr(false)}catch(err:any){setMsg(err.message);setIsErr(true)}finally{setBusy(false)}}
  const router=useRouter();
  const startToday=new Date();startToday.setHours(0,0,0,0);const weekEnd=new Date(startToday.getTime()+7*86400000);
  const isOverdue=(o:ApiObservation)=>o.status!=='RESOLVED'&&!!o.dueDate&&new Date(o.dueDate)<startToday;
  const isDueSoon=(o:ApiObservation)=>o.status!=='RESOLVED'&&!!o.dueDate&&(t=>t>=startToday&&t<=weekEnd)(new Date(o.dueDate));
  const isEscalated=(o:ApiObservation)=>o.status!=='RESOLVED'&&typeof o.escalationLevel==='number'&&o.escalationLevel>0;
  // Filter coming from the dashboard links (?status=… / ?filter=…); the controls below refine it.
  const scoped=rows.filter(o=>status==='open'?o.status!=='RESOLVED':status==='waiting'?['WAITING','TO_RELAUNCH','SENT'].includes(o.status):status==='resolved'?o.status==='RESOLVED':filter==='overdue'?isOverdue(o):filter==='due-soon'?isDueSoon(o):filter==='escalated'?isEscalated(o):true);
  const filterLabel=status==='open'?'Observations ouvertes':status==='waiting'?'En attente entreprises':status==='resolved'?'Clôturées':filter==='overdue'?'En retard':filter==='due-soon'?'Échéance proche':filter==='escalated'?'Escaladées':undefined;
  const visible=useMemo(()=>filterObservations(scoped,filters),[rows,filters,status,filter]);
  const lotOptions=useMemo(()=>options(rows,o=>o.lot),[rows]),companyOptions=useMemo(()=>options(rows,o=>o.company),[rows]);
  const set=(patch:ObservationFilters)=>setFilters(f=>({...f,...patch}));
  const active=hasActiveFilters(filters);
  function clearFilter(){router.replace('/observations')}
  return <>
    <div className="topbar"><div className="title"><div className="eyebrow">Suivi global</div><h1>Observations</h1><p>Toutes les remarques enregistrées.</p></div>{can('observation.write')&&<button className="btn" onClick={()=>setOpen(true)}>+ Observation manuelle</button>}</div>
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}
    {filterLabel&&<div className="filter-banner"><span>Filtre actif :&nbsp;<strong>{filterLabel}</strong></span><button type="button" onClick={clearFilter}>Effacer le filtre</button></div>}
    {rows.length>0&&<div className="obs-filters">
      <label className="obs-search">Recherche<input type="search" value={filters.q} onChange={e=>set({q:e.target.value})} placeholder="Titre, description, référence, lot, entreprise…"/></label>
      <label>Statut<select value={filters.status} onChange={e=>set({status:e.target.value})}><option value="">Tous</option>{STATUSES.map(s=><option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
      <label>Sévérité<select value={filters.severity} onChange={e=>set({severity:e.target.value})}><option value="">Toutes</option>{SEVERITIES.map(s=><option key={s} value={s}>{severityLabel(s)}</option>)}</select></label>
      <label>Lot<select value={filters.lotId} onChange={e=>set({lotId:e.target.value})}><option value="">Tous</option>{lotOptions.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}<option value={NONE}>Sans lot</option></select></label>
      <label>Entreprise<select value={filters.companyId} onChange={e=>set({companyId:e.target.value})}><option value="">Toutes</option>{companyOptions.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}<option value={NONE}>Sans entreprise</option></select></label>
      <label>Origine<select value={filters.review} onChange={e=>set({review:e.target.value as ObservationFilters['review']})}><option value="">Toutes</option><option value="pending">IA · à valider</option><option value="validated">IA · validées</option><option value="rejected">IA · rejetées</option><option value="manual">Saisie manuelle</option></select></label>
      <label>Tri<select value={filters.sort} onChange={e=>set({sort:e.target.value as ObservationFilters['sort']})}><option value="newest">Plus récentes</option><option value="oldest">Plus anciennes</option><option value="due">Échéance</option><option value="severity">Sévérité</option></select></label>
    </div>}
    {rows.length>0&&<div className="obs-count"><span><strong>{visible.length}</strong> / {scoped.length} observation(s)</span>{active&&<button type="button" onClick={()=>setFilters({...NO_FILTERS,sort:filters.sort})}>Réinitialiser les filtres</button>}</div>}
    <div className="section">{rows.length===0?<div className="card empty">Aucune observation.</div>:visible.length===0?<div className="card empty">{active?'Aucune observation ne correspond à votre recherche.':'Aucune observation pour ce filtre.'}</div>:<div className="card table-wrap"><table className="table"><thead><tr><th>Référence</th><th>Lot</th><th>Observation</th><th>Entreprise</th><th>Sévérité</th><th>Échéance</th><th>Statut</th></tr></thead><tbody>{visible.map(o=><tr key={o.id}>
      <td>{o.reference||'—'}</td>
      <td>{o.lot?.name||'—'}</td>
      <td><Link href={`/observations/${o.id}`}>{o.title||o.description||'—'}</Link></td>
      <td>{o.company?.name||'—'}</td>
      <td><span className={`badge ${SEV_TONE[o.severity]||''}`}>{severityLabel(o.severity)}</span></td>
      <td>{fmt(o.dueDate)}</td>
      <td><div className="badges">{o.reviewStatus==='REJECTED'?<span className="badge red">Rejetée</span>:<span className="badge">{statusLabel(o.status)}</span>}{o.reviewStatus==='PENDING'&&<span className="badge yellow">IA · à valider</span>}</div></td>
    </tr>)}</tbody></table></div>}</div>
    {open&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><div className="eyebrow">Nouvelle remarque</div><h2>Observation manuelle</h2></div><button className="icon-btn" onClick={()=>setOpen(false)}>×</button></div><form onSubmit={submit}>{!projectId&&<label>Projet<select name="projectId" required defaultValue=""><option value="" disabled>Choisir</option>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}<div className="form-grid"><label>Lot<select name="lotId"><option value="">Non défini</option>{lots.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label><label>Entreprise<select name="companyId"><option value="">Non définie</option>{companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Sévérité<select name="severity" defaultValue="MEDIUM"><option value="INFO">Information</option><option value="LOW">Faible</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Élevée</option><option value="CRITICAL">Critique</option></select></label><label>Échéance<input type="date" name="dueDate"/></label></div><label>Titre<input name="title" required/></label><label>Description<textarea name="description" required rows={4}/></label><label>Référence<input name="reference"/></label><label>Action attendue<textarea name="requiredAction" rows={3}/></label><div className="wizard-actions"><button type="button" className="btn secondary" onClick={()=>setOpen(false)}>Annuler</button><button className="btn" disabled={busy}>{busy?'Création...':'Créer'}</button></div></form></div></div>}
  </>}
