'use client';
import {useSession} from '@/lib/session';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Bell,CheckCheck,Mail,RefreshCw,TriangleAlert} from 'lucide-react';
import {api,severityLabel,kindLabel} from '@/lib/api';

type N={id:string;kind:string;priority:string;title:string;message:string;href?:string|null;readAt?:string|null;createdAt:string};
export function NotificationCenter(){const {can}=useSession();
  const [rows,setRows]=useState<N[]>([]),[loading,setLoading]=useState(true),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false);
  const load=()=>{setLoading(true);api<N[]>('/notifications').then(setRows).catch(e=>{setMsg(e.message);setIsErr(true)}).finally(()=>setLoading(false))};
  useEffect(()=>{load()},[]);
  async function read(id:string){await api(`/notifications/${id}/read`,{method:'POST'});setRows(r=>r.map(n=>n.id===id?{...n,readAt:new Date().toISOString()}:n))}
  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' });
    setRows(r =>
      r.map(n => ({
        ...n,
        readAt: n.readAt || new Date().toISOString(),
      }))
    );
  }
  async function digest(){setMsg('');setIsErr(false);try{const r:any=await api('/notifications/digest/send',{method:'POST'});setMsg(r.configured?`Synthèse envoyée à ${r.sent} utilisateur(s).`:'L’envoi d’emails n’est pas encore activé sur cet espace.');setIsErr(false)}catch(e:any){setMsg(e.message);setIsErr(true)}}
  const unread=rows.filter(n=>!n.readAt).length;
  return <div className="stack"><div className="card"><div className="section-head"><div><h2>Centre de notifications</h2><p className="muted">Alertes internes, justificatifs à valider, échéances et escalades.</p></div><div className="actions"><button className="btn secondary" onClick={load}><RefreshCw size={15}/>Actualiser</button><button className="btn secondary" onClick={readAll}><CheckCheck size={15}/>Tout marquer lu</button>{can('digest.send')&&<button className="btn" onClick={digest}><Mail size={15}/>Envoyer la synthèse</button>}</div></div>{msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}<div className="grid"><div className="card metric-card"><div className="metric-icon"><Bell size={20}/></div><div><div className="muted">Non lues</div><div className="metric">{unread}</div></div></div><div className="card metric-card"><div className="metric-icon"><TriangleAlert size={20}/></div><div><div className="muted">Critiques</div><div className="metric">{rows.filter(n=>!n.readAt&&n.priority==='CRITICAL').length}</div></div></div></div></div>{loading?<div className="card">Chargement…</div>:rows.length===0?<div className="card"><p className="muted">Aucune notification.</p></div>:<div className="notification-list">{rows.map(n=><div key={n.id} className={`card notification-item ${n.readAt?'is-read':''}`}><div className="notification-main"><div className={`notification-dot p-${n.priority.toLowerCase()}`}/><div><div className="actions"><span className="badge">{kindLabel(n.kind)}</span><span className="badge">{severityLabel(n.priority)}</span></div><h3>{n.title}</h3><p className="muted">{n.message}</p><small>{new Intl.DateTimeFormat('fr-FR',{dateStyle:'short',timeStyle:'short'}).format(new Date(n.createdAt))}</small></div></div><div className="actions">{n.href&&<Link className="btn secondary" href={n.href} onClick={()=>read(n.id)}>Ouvrir</Link>}{!n.readAt&&<button className="btn secondary" onClick={()=>read(n.id)}>Lu</button>}</div></div>)}</div>}</div>
}
