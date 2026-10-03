'use client';
import {useState} from 'react';
import {KeyRound} from 'lucide-react';
import {api,storeSession} from '@/lib/api';
import {useSession} from '@/lib/session';

export const PASSWORD_HINT='10 caractères minimum, avec au moins une lettre et un chiffre ou un symbole.';
const roleLabel=(r?:string|null)=>r==='ADMIN'?'Administrateur':r==='EDITOR'?'Éditeur':r==='USER'?'Consultant':'';

// The signed-in user changes their own password. The API ends every other session of the account.
export function AccountPassword(){
  const {user}=useSession();
  const [msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[busy,setBusy]=useState(false);
  async function submit(e:any){
    e.preventDefault();setMsg('');setIsErr(false);
    const form=e.currentTarget as HTMLFormElement;const f=new FormData(form);
    const body={currentPassword:String(f.get('currentPassword')||''),newPassword:String(f.get('newPassword')||''),confirmPassword:String(f.get('confirmPassword')||'')};
    if(body.newPassword!==body.confirmPassword){setMsg('La confirmation ne correspond pas au nouveau mot de passe.');setIsErr(true);return}
    setBusy(true);
    try{storeSession(await api('/auth/change-password',{method:'POST',body:JSON.stringify(body)}));form.reset();setMsg('Mot de passe modifié. Vos autres sessions ont été déconnectées.')}
    catch(err:any){setMsg(err.message);setIsErr(true)}finally{setBusy(false)}
  }
  return <div className="card" id="account">
    <h2>Mon compte</h2>
    <div className="kv"><span>Nom</span><strong>{user?.displayName||'—'}</strong></div>
    <div className="kv"><span>Email</span><strong>{user?.email||'—'}</strong></div>
    <div className="kv"><span>Rôle</span><strong>{roleLabel(user?.role)||'—'}</strong></div>
    <h3 style={{marginTop:18}}>Changer mon mot de passe</h3>
    <form onSubmit={submit}>
      <label>Mot de passe actuel<input name="currentPassword" type="password" autoComplete="current-password" required/></label>
      <label>Nouveau mot de passe<input name="newPassword" type="password" autoComplete="new-password" minLength={10} required/></label>
      <label>Confirmer le nouveau mot de passe<input name="confirmPassword" type="password" autoComplete="new-password" minLength={10} required/></label>
      <p className="muted">{PASSWORD_HINT}</p>
      {msg&&<div className={isErr?'notice error':'notice success'} role="status">{msg}</div>}
      <button className="btn" disabled={busy}><KeyRound size={16}/>{busy?'Enregistrement...':'Changer mon mot de passe'}</button>
    </form>
  </div>
}
