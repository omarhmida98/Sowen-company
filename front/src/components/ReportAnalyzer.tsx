'use client';
import {useState} from 'react';
import {FileUp,Info,TriangleAlert} from 'lucide-react';
import {api} from '@/lib/api';

export function ReportAnalyzer({projectId}:{projectId:string}){
  const [file,setFile]=useState<File|null>(null),[issuer,setIssuer]=useState(''),[busy,setBusy]=useState(false),[msg,setMsg]=useState(''),[result,setResult]=useState<any>(null);
  async function analyze(){
    if(!file)return;
    setBusy(true);setMsg('');setResult(null);
    const form=new FormData();form.append('file',file);
    try{
      const r=await api(`/reports/upload?projectId=${encodeURIComponent(projectId)}&issuer=${encodeURIComponent(issuer)}`,{method:'POST',body:form});
      setResult(r);setMsg('Rapport importé.');
    }catch(e:any){setMsg(e.message)}finally{setBusy(false)}
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
    {msg&&<div className={msg.toLowerCase().includes('error')?'notice error':'notice'}>{msg}</div>}
    {result&&<div className="card">
      <h3>Résultat de l’analyse</h3>
      <div className="kv"><span>Texte extrait</span><strong>{result.extractedTextLength||0} caractères</strong></div>
      <div className="kv"><span>IA configurée</span><strong>{result.aiConfigured?'Oui':'Non'}</strong></div>
      {result.aiModel&&<div className="kv"><span>Modèle IA</span><strong>{result.aiModel}</strong></div>}
      {pct!==null&&<div className="kv"><span>Confiance moyenne</span><strong>{pct}%</strong></div>}
      <div className="kv"><span>Observations créées</span><strong>{result.createdObservations||0}</strong></div>
      <div className="kv"><span>Brouillons entreprise créés</span><strong>{result.createdDrafts||0}</strong></div>
      <div className="kv"><span>Destinataires à compléter</span><strong>{result.needsRecipient||0}</strong></div>
      <div className="kv"><span>Affectations entreprise automatiques</span><strong>{result.autoAssigned||0}</strong></div>
      <div className="kv"><span>À valider humainement</span><strong>{result.needsValidation||0}</strong></div>
      {result.analysisStatus&&<div className="kv"><span>Statut analyse</span><strong>{result.analysisStatus}</strong></div>}
      {result.needsReview&&<div className="notice warning"><TriangleAlert size={18}/>Certaines observations ont une confiance faible ou des informations manquantes. Elles doivent être vérifiées avant envoi aux entreprises.</div>}
      {!result.aiConfigured&&<div className="actions"><Info size={18}/><p className="muted">Le rapport est bien stocké. Ajoute OPENAI_API_KEY dans back/.env pour activer l’extraction automatique des observations.</p></div>}
    </div>}
  </div>
}
