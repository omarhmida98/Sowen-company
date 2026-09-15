'use client';

import {useEffect,useState} from 'react';
import {UserPlus,X} from 'lucide-react';
import {api} from '@/lib/api';

type Member={id:string;email:string;displayName?:string|null;role:string};
type Assignment={id:string;userId:string;user:Member};

export function AssigneeManager({observationId,initial=[]}:{observationId:string;initial?:Assignment[]}){
  const [members,setMembers]=useState<Member[]>([]);
  const [assigned,setAssigned]=useState<Assignment[]>(initial);
  const [selected,setSelected]=useState('');
  const [msg,setMsg]=useState('');
  useEffect(()=>{api<Member[]>('/users/assignable').then(setMembers).catch(()=>{})},[]);

  async function add(){
    if(!selected)return;
    try{
      const row=await api<Assignment>(`/observations/${observationId}/assign`,{method:'POST',body:JSON.stringify({userId:selected})});
      setAssigned(prev=>prev.some(x=>x.userId===row.userId)?prev:[...prev,row]);setSelected('');setMsg('Responsable ajouté.');
    }catch(e:any){setMsg(e.message)}
  }
  async function remove(userId:string){
    try{await api(`/observations/${observationId}/assign/${userId}`,{method:'DELETE'});setAssigned(prev=>prev.filter(x=>x.userId!==userId));}catch(e:any){setMsg(e.message)}
  }

  return <div className="card"><h3>Responsables internes</h3><div className="actions"><select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Sélectionner…</option>{members.filter(m=>!assigned.some(a=>a.userId===m.id)).map(m=><option key={m.id} value={m.id}>{m.displayName||m.email}</option>)}</select><button className="btn secondary" disabled={!selected} onClick={add}><UserPlus size={16}/>Assigner</button></div>{msg&&<div className="notice">{msg}</div>}<div className="stack" style={{marginTop:12}}>{assigned.map(a=><div className="integration" key={a.id}><div><strong>{a.user.displayName||a.user.email}</strong><p>{a.user.email} · {a.user.role}</p></div><button className="icon-btn" title="Retirer" onClick={()=>remove(a.userId)}><X size={15}/></button></div>)}{assigned.length===0&&<p className="muted">Aucun responsable interne.</p>}</div></div>
}
