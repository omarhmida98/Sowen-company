'use client';
import {useEffect} from 'react';
import {ErrorNotice} from '@/components/UiState';
export default function GlobalError({error,reset}:{error:Error & {digest?:string};reset:()=>void}){
  useEffect(()=>{console.error(error)},[error]);
  return <main className="standalone-state"><ErrorNotice message={error.message||'Erreur inattendue.'} onRetry={reset}/></main>
}
