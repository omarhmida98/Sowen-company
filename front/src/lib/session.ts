'use client';
import {useEffect,useState} from 'react';
import {Action,Role,can as allowed,isRole} from './permissions';

export type SessionUser={id:string;email:string;displayName?:string|null;role:Role;organizationId:string};
// Fired whenever the stored user changes (sign-in, role refreshed from the API, sign-out).
export const SESSION_EVENT='sowen-session';

export function storedUser():SessionUser|null{
  try{const u=JSON.parse(localStorage.getItem('sowen_user')||'null');return u&&isRole(u.role)?u:null}catch{return null}
}

// The signed-in user and what they may do. Until the session has been read, `can` answers false, so that
// controls a user is not allowed to use are never shown, even briefly.
export function useSession(){
  const [user,setUser]=useState<SessionUser|null>(null);
  useEffect(()=>{const sync=()=>setUser(storedUser());sync();window.addEventListener(SESSION_EVENT,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(SESSION_EVENT,sync);window.removeEventListener('storage',sync)}},[]);
  return {user,role:user?.role??null,can:(action:Action)=>allowed(user?.role,action)};
}
