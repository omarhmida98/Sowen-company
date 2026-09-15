'use client';
import {useEffect,useState} from 'react';
import {useParams} from 'next/navigation';
import Link from 'next/link';
import {Shell} from '@/components/Shell';
import {PrecontrolForm} from '@/components/PrecontrolForm';
import {api,ApiProject} from '@/lib/api';
export default function Page(){const {projectId}=useParams<{projectId:string}>();const [project,setProject]=useState<ApiProject|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('');useEffect(()=>{api<ApiProject>(`/projects/${projectId}`).then(setProject).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[projectId]);return <Shell><div className="topbar"><div className="title"><div className="eyebrow">Pré-contrôle</div><h1>{project?.name||'Analyse préventive'}</h1><p>Décrire les travaux et rapprocher les règles applicables avant le contrôle.</p></div><Link className="btn secondary" href={`/projects/${projectId}`}>← Projet</Link></div>{loading?<div className="card empty">Chargement…</div>:error||!project?<div className="notice error">{error||'Projet introuvable.'}</div>:<PrecontrolForm projectId={projectId} buildingType={project.buildingType} erpType={project.erpType}/>}</Shell>}
