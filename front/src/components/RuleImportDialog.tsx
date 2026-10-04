'use client';
import {useState} from 'react';
import {DownloadCloud,FileSearch,UploadCloud} from 'lucide-react';
import {api,downloadFile,severityLabel} from '@/lib/api';
import {RULES_DISCLAIMER} from '@/lib/rule-filters';

type Row={line:number;status:'OK'|'ERROR'|'DUPLICATE';errors:string[];duplicateOf?:'FILE'|'LIBRARY';rule:{title:string;domain:string;lotName?:string|null;severity:string;reference?:string|null}};
type Preview={fileErrors:string[];unknownColumns:string[];rows:Row[];summary:{total:number;valid:number;errors:number;duplicates:number};canImport:boolean};

// Import of rules from a CSV file, in two steps: the file is analysed and shown line by line, then imported.
// Nothing is written before the user confirms, and a file with an invalid line is not imported at all.
export function RuleImportDialog({onClose,onImported}:{onClose:()=>void;onImported:(message:string)=>void}){
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState<Preview|null>(null),[busy,setBusy]=useState(''),[err,setErr]=useState('');
  const form=()=>{const f=new FormData();f.append('file',file as File);return f};
  async function analyse(){if(!file)return;setBusy('preview');setErr('');setPreview(null);try{setPreview(await api<Preview>('/rules/import/preview',{method:'POST',body:form()}))}catch(e:any){setErr(e.message)}finally{setBusy('')}}
  async function run(){
    if(!file||!preview?.canImport)return;setBusy('import');setErr('');
    try{const r=await api<{created:number;duplicatesSkipped:number}>('/rules/import',{method:'POST',body:form()});onImported(`Import terminé : ${r.created} règle(s) ajoutée(s), ${r.duplicatesSkipped} doublon(s) ignoré(s).`);onClose()}
    catch(e:any){setErr(e.message)}finally{setBusy('')}
  }
  const template=()=>downloadFile('/rules/import/template','modele-regles-sowen.csv').catch((e:any)=>setErr(e.message));
  const s=preview?.summary;
  return <div className="modal-backdrop"><div className="modal import-modal" role="dialog" aria-modal="true">
    <div className="modal-head"><div><div className="eyebrow">Bibliothèque de règles</div><h2>Importer des règles (CSV)</h2></div><button className="icon-btn" onClick={onClose}>×</button></div>
    <p className="muted">Préparez votre fichier à partir du modèle : une ligne par règle, colonnes séparées par un point-virgule, enregistré en CSV UTF-8. Le fichier est d’abord analysé ; rien n’est importé avant votre confirmation.</p>
    <div className="actions"><button type="button" className="btn secondary compact" onClick={template}><DownloadCloud size={14}/>Télécharger le modèle CSV</button></div>
    <label>Fichier CSV<input type="file" accept=".csv,text/csv" onChange={e=>{setFile(e.target.files?.[0]||null);setPreview(null);setErr('')}}/></label>
    <div className="actions"><button type="button" className="btn secondary" disabled={!file||busy!==''} onClick={analyse}><FileSearch size={15}/>{busy==='preview'?'Analyse...':'Analyser le fichier'}</button></div>
    {err&&<div className="notice error">{err}</div>}
    {preview&&<div className="import-preview">
      {preview.fileErrors.map(e=><div className="notice error" key={e}>{e}</div>)}
      {preview.unknownColumns.length>0&&<div className="notice"><span>Colonnes ignorées :</span> <span>{preview.unknownColumns.join(', ')}</span></div>}
      {s&&s.total>0&&<>
        <div className="badges" data-import-summary><span className="badge"><span>{s.total}</span> <span>ligne(s)</span></span><span className="badge green"><span>{s.valid}</span> <span>à importer</span></span>{s.duplicates>0&&<span className="badge yellow"><span>{s.duplicates}</span> <span>doublon(s) ignoré(s)</span></span>}{s.errors>0&&<span className="badge red"><span>{s.errors}</span> <span>en erreur</span></span>}</div>
        {s.errors>0&&<div className="notice error">Le fichier contient des lignes invalides : rien ne sera importé tant qu’elles ne sont pas corrigées.</div>}
        {s.errors===0&&s.valid===0&&<div className="notice">Toutes les lignes existent déjà dans votre bibliothèque : il n’y a rien à importer.</div>}
        <div className="table-wrap"><table className="table"><thead><tr><th>Ligne</th><th>État</th><th>Règle</th><th>Catégorie</th><th>Lot</th><th>Sévérité</th></tr></thead><tbody>{preview.rows.map(r=><tr key={r.line} data-row={r.status}>
          <td>{r.line}</td>
          <td><span className={`badge ${r.status==='OK'?'green':r.status==='ERROR'?'red':'yellow'}`}>{r.status==='OK'?'À importer':r.status==='ERROR'?'Erreur':r.duplicateOf==='FILE'?'Doublon dans le fichier':'Déjà dans la bibliothèque'}</span></td>
          <td><strong>{r.rule.title||'—'}</strong>{r.rule.reference&&<div className="muted">{r.rule.reference}</div>}{r.errors.map(e=><div className="refusal" key={e}>{e}</div>)}</td>
          <td>{r.rule.domain||'—'}</td><td>{r.rule.lotName||'Tous les lots'}</td><td>{severityLabel(r.rule.severity)}</td>
        </tr>)}</tbody></table></div>
      </>}
    </div>}
    <p className="muted">{RULES_DISCLAIMER}</p>
    <div className="wizard-actions"><button type="button" className="btn secondary" onClick={onClose}>Annuler</button><button type="button" className="btn" disabled={!preview?.canImport||busy!==''} onClick={run}><UploadCloud size={15}/>{busy==='import'?'Import...':`Importer ${s?.valid||0} règle(s)`}</button></div>
  </div></div>
}
