'use client';
import {useEffect} from 'react';
import {ErrorNotice} from '@/components/UiState';
export default function GlobalError({error,reset}:{error:Error & {digest?:string};reset:()=>void}){
  useEffect(()=>{console.error(error)},[error]);
  return <main className="standalone-state"><ErrorNotice message="Une erreur inattendue est survenue. Merci de réessayer." onRetry={reset}/></main>
}
