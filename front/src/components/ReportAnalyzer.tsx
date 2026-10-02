'use client';
import {useState} from 'react';
import {FileUp,Info,TriangleAlert} from 'lucide-react';
import {api} from '@/lib/api';

export function ReportAnalyzer({projectId}:{projectId:string}){
  const [file,setFile]=useState<File|null>(null),[issuer,setIssuer]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[result,setResult]=useState<any>(null);
  async function analyze(){
    if(!file)return;
    setBusy(true);setMsg('');setIsErr(false);setResult(null);
    const form=new FormData();form.append('file',file);
    try{
      const r=await api(`/reports/upload?projectId=${encodeURIComponent(projectId)}&issuer=${encodeURIComponent(issuer)}`,{method:'POST',body:form});
      setResult(r);setMsg('Rapport importé.');setIsErr(false);
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }
  const pct=typeof result?.aiConfidence==='number'?Math.round(result.aiConfidence*100):null;
  return <div className="stack">
    <div className="card upload-card">
      <FileUp size={36}/><h2>Importer un rapport Bureau de Contrôle</h2>
      <p className="muted">Le PDF est enregistré, son texte est extrait, puis l’IA transforme les remarques du rapport en observations structurées. Les résultats incertains restent à valider.</p>
      <label>Émetteur / Bureau de contrôle<input value={issuer} onChange={e=>setIssuer(e.target.value)} placeholder="SOCOTEC, APAVE, Bureau Veritas..."/></label>
      <input id="report" type="file" accept="application/pdf" onChange={e=>setFile(e.target.files?.[0]||null)}/>
      <label htmlFor="report" className="btn secondary">Choisir un PDF</label>
      {file&&<div className="file-pill">{file.name}</div>}
      <button className="btn" disabled={!file||busy} onClick={analyze}>{busy?'Analyse en cours...':'Analyser le rapport'}</button>
    </div>
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}
    {result&&<div className="card">
      <h3>Résultat de l’analyse</h3>
      {result.documentType&&<div className="kv"><span>Type de document détecté</span><strong>{result.documentType}</strong></div>}
      {result.summary&&<p className="muted">{result.summary}</p>}
      {result.analysisStatus==='FAILED'&&result.analysisError&&<div className="notice error">{result.analysisError}</div>}
      <div className="kv"><span>Texte du rapport</span><strong>{result.extractedTextLength||0} caractères</strong></div>
      {pct!==null&&<div className="kv"><span>Pertinence des résultats</span><strong>{pct}%</strong></div>}
      <div className="kv"><span>Observations créées</span><strong>{result.createdObservations||0}</strong></div>
      <div className="kv"><span>Brouillons entreprise créés</span><strong>{result.createdDrafts||0}</strong></div>
      <div className="kv"><span>Destinataires à compléter</span><strong>{result.needsRecipient||0}</strong></div>
      <div className="kv"><span>Affectations entreprise automatiques</span><strong>{result.autoAssigned||0}</strong></div>
      <div className="kv"><span>À valider</span><strong>{result.needsValidation||0}</strong></div>
      {result.needsReview&&<div className="notice warning"><TriangleAlert size={18}/>Certaines observations sont incomplètes ou incertaines. Elles doivent être vérifiées avant envoi aux entreprises.</div>}
      {!result.aiConfigured&&<div className="actions"><Info size={18}/><p className="muted">Le rapport a bien été enregistré. L’extraction automatique des observations sera disponible dès son activation.</p></div>}
    </div>}
  </div>
}
