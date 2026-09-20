'use client';
import Link from 'next/link';
import {useEffect,useState} from 'react';

import {api,ApiProject,statusLabel} from '@/lib/api';
import {ArrowRight} from 'lucide-react';
export default function ProjectsPage(){
  const [projects,setProjects]=useState<ApiProject[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  useEffect(()=>{api<ApiProject[]>('/projects').then(setProjects).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[]);
  return <><div className="topbar"><div className="title"><div className="eyebrow">Projets</div><h1>Projets</h1><p>Pré-contrôle, rapports BC et suivi des entreprises.</p></div><Link className="btn" href="/projects/new">+ Nouveau projet</Link></div>{error&&<div className="notice error">{error}</div>}{loading?<div className="card empty">Chargement…</div>:(projects.length===0?<div className="card"><h3>Aucun projet</h3><p className="muted">Crée ton premier projet pour commencer.</p></div>:<div className="project-list">{projects.map(p=><Link href={`/projects/${p.id}`} className="card project-row project-link" key={p.id}><div><div className="eyebrow">{p.buildingType}{p.erpType?` · ${p.erpType}`:''}</div><strong className="project-name">{p.name}</strong><div className="muted">{p.address||'Adresse non renseignée'} · {statusLabel(p.status)}</div></div><div className="compliance"><span>{p._count?.observations??0} observation(s)</span><ArrowRight size={18}/></div></Link>)}</div>)}</>
}