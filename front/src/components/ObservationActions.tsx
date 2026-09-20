'use client';

import {useState} from 'react';
import {useRouter} from 'next/navigation';
import Link from 'next/link';
import {AlertTriangle, CheckCircle2, FileText, Mail, RotateCcw, Send, ShieldAlert} from 'lucide-react';
import {api} from '@/lib/api';

type Props={id:string;projectId:string;status:string;emailId?:string|null};

export function ObservationActions({id,projectId,status,emailId}:Props){
  const router=useRouter();
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState('');
  const [isErr,setIsErr]=useState(false);

  async function transition(next:string,note?:string){
    setBusy(true);setMsg('');setIsErr(false);
    try{
      await api(`/observations/${id}/status`,{method:'POST',body:JSON.stringify({status:next,note})});
      router.refresh();
      setMsg('Statut mis à jour.');setIsErr(false);
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }

  async function remind(){
    if(!emailId){setMsg('Aucun brouillon ou mail associé à cette observation.');setIsErr(true);return}
    setBusy(true);setMsg('');setIsErr(false);
    try{
      await api(`/emails/${emailId}/remind`,{method:'POST'});
      router.refresh();
      setMsg('Relance envoyée.');setIsErr(false);
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }

  const canClose=status!=='RESOLVED';
  return <>
    <div className="action-list">
      <Link href={`/projects/${projectId}/mails`}><Mail size={17}/>Voir les mails</Link>
      <Link href={`/projects/${projectId}/documents`}><FileText size={17}/>Documents</Link>

      {status==='OPEN'&&<button disabled={busy} onClick={()=>transition('TO_SEND','Prête à être transmise à l’entreprise')}><Send size={17}/>Préparer l’envoi</button>}
      {status==='SENT'&&<button disabled={busy} onClick={()=>transition('WAITING','En attente du retour entreprise')}><Send size={17}/>Passer en attente</button>}
      {['SENT','WAITING','TO_RELAUNCH'].includes(status)&&<button disabled={busy} onClick={remind}><AlertTriangle size={17}/>Relancer l’entreprise</button>}
      {status==='BLOCKED'&&<button disabled={busy} onClick={()=>transition('OPEN','Blocage levé')}><RotateCcw size={17}/>Lever le blocage</button>}
      {status==='RESOLVED'&&<button disabled={busy} onClick={()=>transition('OPEN','Observation rouverte')}><RotateCcw size={17}/>Rouvrir</button>}
      {canClose&&<button disabled={busy} onClick={()=>transition('RESOLVED','Observation validée et clôturée')}><CheckCircle2 size={17}/>Clôturer</button>}
      {!['BLOCKED','RESOLVED'].includes(status)&&<button disabled={busy} onClick={()=>transition('BLOCKED','Point bloqué - intervention requise')}><ShieldAlert size={17}/>Bloquer</button>}
    </div>
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}
  </>
}
