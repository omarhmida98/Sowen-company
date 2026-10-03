'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useParams,useRouter} from 'next/navigation';
import {api,clearSession,storeSession} from '@/lib/api';
import {PreferenceControls} from '@/components/Preferences';
import {PASSWORD_HINT} from '@/components/AccountPassword';

type Invitation={type:'INVITATION'|'PASSWORD_RESET';email:string;displayName?:string|null;organizationName:string;expiresAt:string};

// Landing page of an invitation or password-reset link: the person chooses their own password.
export default function InvitationPage(){
  const {token}=useParams<{token:string}>();const router=useRouter();
  const [info,setInfo]=useState<Invitation|null>(null),[state,setState]=useState<'loading'|'ready'|'invalid'>('loading'),[invalidMsg,setInvalidMsg]=useState(''),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
  // The token is sent in the request body, so it does not appear in the API's request logs.
  useEffect(()=>{api<Invitation>('/auth/invitation',{method:'POST',body:JSON.stringify({token})}).then(r=>{setInfo(r);setState('ready')}).catch((e:any)=>{setInvalidMsg(e.message);setState('invalid')})},[token]);
  async function submit(e:any){
    e.preventDefault();setMsg('');
    const f=new FormData(e.currentTarget);const password=String(f.get('password')||''),confirmPassword=String(f.get('confirmPassword')||'');
    if(password!==confirmPassword){setMsg('La confirmation ne correspond pas au mot de passe.');return}
    setBusy(true);
    try{const session=await api<any>('/auth/invitation/accept',{method:'POST',body:JSON.stringify({token,password,confirmPassword})});clearSession();storeSession(session);router.replace('/')}
    catch(err:any){setMsg(err.message);setBusy(false)}
  }
  const invitation=info?.type!=='PASSWORD_RESET';
  return <main className="auth-page">
    <meta name="referrer" content="no-referrer"/>
    <div className="auth-tools"><PreferenceControls/></div>
    <div className="card form-card auth-card">
      <div className="auth-brand"><div className="brand-mark">S</div><div><strong>SOWEN</strong><small>{state==='ready'&&!invitation?'Mot de passe':'Invitation'}</small></div></div>
      {state==='loading'&&<p className="muted">Vérification du lien…</p>}
      {state==='invalid'&&<><h1>Lien invalide</h1><div className="notice error">{invalidMsg||'Ce lien est invalide ou a expiré.'}</div><div className="wizard-actions"><Link className="btn secondary" href="/login">Aller à la connexion</Link></div></>}
      {state==='ready'&&info&&<>
        <h1>{invitation?'Activer mon compte':'Choisir un nouveau mot de passe'}</h1>
        <p className="muted">{invitation?'Vous rejoignez l’espace':'Compte de l’espace'} <strong>{info.organizationName}</strong>.</p>
        <div className="kv"><span>Email</span><strong>{info.email}</strong></div>
        <form onSubmit={submit}>
          <input type="hidden" name="username" autoComplete="username" value={info.email} readOnly/>
          <label>Mot de passe<input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus/></label>
          <label>Confirmer le mot de passe<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required/></label>
          <p className="muted">{PASSWORD_HINT}</p>
          {msg&&<div className="notice error">{msg}</div>}
          <div className="wizard-actions"><button className="btn" disabled={busy}>{busy?'Enregistrement...':invitation?'Activer mon compte':'Enregistrer le mot de passe'}</button></div>
        </form>
      </>}
    </div>
  </main>
}
