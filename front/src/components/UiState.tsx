'use client';
import {AlertTriangle, LoaderCircle, Inbox, RefreshCcw} from 'lucide-react';

export function LoadingCard({label='Chargement…'}:{label?:string}){
  return <div className="card ui-state" role="status" aria-live="polite"><LoaderCircle className="spin" size={22}/><div><strong>{label}</strong><p className="muted">Merci de patienter quelques secondes.</p></div></div>
}

export function ErrorNotice({message,onRetry}:{message:string;onRetry?:()=>void}){
  return <div className="notice error ui-error" role="alert"><AlertTriangle size={18}/><div><strong>Une erreur est survenue</strong><div>{message}</div></div>{onRetry&&<button className="btn secondary compact" onClick={onRetry}><RefreshCcw size={14}/>Réessayer</button>}</div>
}

export function EmptyState({title='Aucune donnée',description,action}:{title?:string;description?:string;action?:React.ReactNode}){
  return <div className="card empty ui-empty"><Inbox size={28}/><h3>{title}</h3>{description&&<p className="muted">{description}</p>}{action&&<div className="actions">{action}</div>}</div>
}
