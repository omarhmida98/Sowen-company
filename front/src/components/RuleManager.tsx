'use client';
import {useEffect,useMemo,useState} from 'react';
import {DownloadCloud,Pencil,Plus,Power,Trash2,UploadCloud} from 'lucide-react';
import {api,downloadFile,ApiLot,ApiRule,severityLabel} from '@/lib/api';
import {useSession} from '@/lib/session';
import {ALL_LOTS,RULES_DISCLAIMER,RuleFilters,categories,filterRules,hasActiveRuleFilters,libraryState} from '@/lib/rule-filters';
import {RuleImportDialog} from './RuleImportDialog';

const SEV_TONE:Record<string,string>={CRITICAL:'red',HIGH:'red',MEDIUM:'yellow',LOW:'',INFO:''};
const NO_FILTERS:RuleFilters={q:'',lotId:'',category:'',status:''};

export function RuleManager(){
  const {role,can}=useSession();const canWrite=can('rule.write');
  const [rows,setRows]=useState<ApiRule[]|null>(null),[lots,setLots]=useState<ApiLot[]>([]),[filters,setFilters]=useState<RuleFilters>(NO_FILTERS);
  const [editing,setEditing]=useState<ApiRule|'new'|null>(null),[removing,setRemoving]=useState<ApiRule|null>(null),[importing,setImporting]=useState(false);
  const [msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false),[busy,setBusy]=useState(false),[formErr,setFormErr]=useState('');
  const load=async()=>{try{const [r,l]=await Promise.all([api<ApiRule[]>('/rules'),api<ApiLot[]>('/lots')]);setRows(r);setLots(l)}catch(e:any){setMsg(e.message);setIsErr(true);setRows([])}};
  useEffect(()=>{load()},[]);
  const all=rows||[];
  const visible=useMemo(()=>filterRules(all,filters),[rows,filters]);
  const cats=useMemo(()=>categories(all),[rows]);
  const lotOptions=useMemo(()=>{const m=new Map<string,string>();for(const r of all)if(r.lot)m.set(r.lot.id,r.lot.name);return [...m].map(([id,name])=>({id,name})).sort((a,b)=>a.name.localeCompare(b.name,'fr'))},[rows]);
  const state=libraryState({total:all.length,active:all.filter(r=>r.active).length});
  const set=(patch:RuleFilters)=>setFilters(f=>({...f,...patch}));
  const ok=(text:string)=>{setMsg(text);setIsErr(false)};
  const fail=(e:any)=>{setMsg(e.message);setIsErr(true)};

  async function save(e:any){
    e.preventDefault();setBusy(true);setFormErr('');
    const f=new FormData(e.currentTarget as HTMLFormElement);const v=(k:string)=>String(f.get(k)||'').trim();
    // An emptied optional field is sent as null so that it is cleared.
    const body={title:v('title'),domain:v('domain'),requirement:v('requirement'),summary:v('summary')||null,lotId:v('lotId')||null,workType:v('workType')||null,reference:v('reference')||null,sourceDocument:v('sourceDocument')||null,severity:v('severity'),controlPoint:v('controlPoint')||null,actionRequest:v('actionRequest')||null,evidenceRequired:v('evidenceRequired')||null,buildingType:v('buildingType')||null,erpType:v('erpType')||null,active:f.get('active')==='on'};
    try{
      if(editing==='new')await api('/rules',{method:'POST',body:JSON.stringify(body)});else if(editing)await api(`/rules/${editing.id}`,{method:'PATCH',body:JSON.stringify(body)});
      ok(editing==='new'?'Règle ajoutée.':'Règle modifiée.');setEditing(null);await load();
    }catch(err:any){setFormErr(err.message)}finally{setBusy(false)}
  }
  async function toggle(r:ApiRule){try{await api(`/rules/${r.id}`,{method:'PATCH',body:JSON.stringify({active:!r.active})});await load();ok(r.active?'Règle désactivée : elle n’est plus proposée par le pré-contrôle.':'Règle activée.')}catch(e:any){fail(e)}}
  async function remove(r:ApiRule){setRemoving(null);try{await api(`/rules/${r.id}`,{method:'DELETE'});await load();ok('Règle supprimée.')}catch(e:any){fail(e)}}
  const template=()=>downloadFile('/rules/import/template','modele-regles-sowen.csv').catch(fail);
  const current=editing&&editing!=='new'?editing:null;

  return <>
    <div className="topbar"><div className="title"><div className="eyebrow">Base de connaissance</div><h1>Bibliothèque de règles</h1><p>Les règles de votre organisation, utilisées par le pré-contrôle préventif.</p></div>
      {canWrite&&<div className="actions"><button className="btn secondary" onClick={()=>setImporting(true)}><UploadCloud size={16}/>Importer (CSV)</button><button className="btn" onClick={()=>{setFormErr('');setEditing('new')}}><Plus size={16}/>Ajouter une règle</button></div>}
    </div>
    {msg&&<div className={isErr?'notice error':'notice'}>{msg}</div>}
    <div className="notice warning rules-disclaimer">{RULES_DISCLAIMER}</div>

    {rows===null?<div className="card empty">Chargement…</div>:state==='EMPTY'?<div className="card empty-library" data-library="EMPTY">
      <h2>Votre bibliothèque de règles est vide</h2>
      <p>Le pré-contrôle préventif compare les travaux que vous décrivez aux règles de cette bibliothèque. Tant qu’elle ne contient aucune règle active, il ne peut rien proposer.</p>
      {!role?null:canWrite?<><p className="muted">Ajoutez vos règles une par une, ou importez-les depuis un fichier CSV préparé à partir du modèle.</p><div className="actions"><button className="btn" onClick={()=>{setFormErr('');setEditing('new')}}><Plus size={16}/>Ajouter une règle</button><button className="btn secondary" onClick={()=>setImporting(true)}><UploadCloud size={16}/>Importer un fichier CSV</button><button className="btn secondary" onClick={template}><DownloadCloud size={16}/>Télécharger le modèle CSV</button></div></>
        :<p className="muted">Votre rôle permet de consulter les règles. Demandez à un administrateur ou à un éditeur de votre organisation d’en ajouter.</p>}
    </div>:<>
      {state==='ALL_INACTIVE'&&<div className="notice warning" data-library="ALL_INACTIVE">Toutes les règles sont désactivées : le pré-contrôle ne peut rien proposer tant qu’aucune règle n’est active.</div>}
      <div className="obs-filters">
        <label className="obs-search">Recherche<input type="search" value={filters.q} onChange={e=>set({q:e.target.value})} placeholder="Titre, exigence, référence, type de travaux…"/></label>
        <label>Lot<select value={filters.lotId} onChange={e=>set({lotId:e.target.value})}><option value="">Tous</option>{lotOptions.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}<option value={ALL_LOTS}>Tous lots (sans lot précis)</option></select></label>
        <label>Catégorie<select value={filters.category} onChange={e=>set({category:e.target.value})}><option value="">Toutes</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}</select></label>
        <label>Statut<select value={filters.status} onChange={e=>set({status:e.target.value as RuleFilters['status']})}><option value="">Toutes</option><option value="active">Actives</option><option value="inactive">Inactives</option></select></label>
      </div>
      <div className="obs-count"><span><strong>{visible.length}</strong> / {all.length} règle(s)</span>{hasActiveRuleFilters(filters)&&<button type="button" onClick={()=>setFilters(NO_FILTERS)}>Réinitialiser les filtres</button>}</div>
      <div className="section">{visible.length===0?<div className="card empty">Aucune règle ne correspond à votre recherche.</div>:<div className="rules-grid">{visible.map(r=><div className={`card rule${r.active?'':' rule-inactive'}`} key={r.id} data-rule={r.title}>
        <div className="rule-top"><div className="badges"><span className={`badge ${SEV_TONE[r.severity]||''}`}>{severityLabel(r.severity)}</span><span className={`badge ${r.active?'green':''}`}>{r.active?'Active':'Inactive'}</span>{r.buildingType&&<span className="badge">{r.buildingType}{r.erpType?` · ${r.erpType}`:''}</span>}</div></div>
        <div className="eyebrow">{r.domain} · {r.lot?.name||'Tous les lots'}{r.workType?` · ${r.workType}`:''}</div>
        <h3>{r.title}</h3>
        {r.summary&&r.summary!==r.requirement&&<p>{r.summary}</p>}
        <div className="detail-block"><small>Exigence</small><p>{r.requirement}</p></div>
        <div className="detail-block"><small>Référence</small><p>{r.reference||'Non renseignée'}{r.sourceDocument?` — ${r.sourceDocument}`:''}</p></div>
        {r.controlPoint&&<div className="detail-block"><small>À vérifier avant travaux</small><p>{r.controlPoint}</p></div>}
        {r.actionRequest&&<div className="detail-block"><small>Action préventive recommandée</small><p>{r.actionRequest}</p></div>}
        {r.evidenceRequired&&<div className="detail-block"><small>Justificatif attendu</small><p>{r.evidenceRequired}</p></div>}
        <div className="actions"><span className="badge">{r._count?.versions||1} version(s)</span>{canWrite&&<><button className="btn secondary compact" onClick={()=>{setFormErr('');setEditing(r)}}><Pencil size={14}/>Modifier</button><button className="btn secondary compact" onClick={()=>toggle(r)}><Power size={14}/>{r.active?'Désactiver':'Activer'}</button><button className="icon-btn" title="Supprimer" aria-label="Supprimer" onClick={()=>setRemoving(r)}><Trash2 size={15}/></button></>}</div>
      </div>)}</div>}</div>
    </>}

    {editing&&<div className="modal-backdrop"><div className="modal rule-modal">
      <div className="modal-head"><div><div className="eyebrow">Bibliothèque de règles</div><h2>{current?'Modifier la règle':'Ajouter une règle'}</h2></div><button className="icon-btn" onClick={()=>setEditing(null)}>×</button></div>
      <form onSubmit={save} key={current?.id||'new'}>
        <label>Titre<input name="title" required maxLength={200} defaultValue={current?.title||''}/></label>
        <div className="form-grid">
          <label>Catégorie<input name="domain" required maxLength={80} list="rule-categories" defaultValue={current?.domain||''} placeholder="Sécurité incendie, accessibilité…"/></label>
          <label>Lot concerné<select name="lotId" defaultValue={current?.lot?.id||''}><option value="">Tous les lots</option>{lots.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label>Type de travaux<input name="workType" maxLength={120} defaultValue={current?.workType||''} placeholder="Cloisonnement, tableau électrique…"/></label>
          <label>Sévérité<select name="severity" defaultValue={current?.severity||'MEDIUM'}><option value="INFO">Information</option><option value="LOW">Faible</option><option value="MEDIUM">Moyenne</option><option value="HIGH">Élevée</option><option value="CRITICAL">Critique</option></select></label>
        </div>
        <datalist id="rule-categories">{cats.map(c=><option key={c} value={c}/>)}</datalist>
        <label>Description<textarea name="summary" rows={2} maxLength={2000} defaultValue={current?.summary&&current.summary!==current.requirement?current.summary:''}/></label>
        <label>Exigence<textarea name="requirement" required rows={3} maxLength={4000} defaultValue={current?.requirement||''}/></label>
        <div className="form-grid">
          <label>Référence (texte, article, clause)<input name="reference" maxLength={200} defaultValue={current?.reference||''}/></label>
          <label>Document source<input name="sourceDocument" maxLength={200} defaultValue={current?.sourceDocument||''}/></label>
        </div>
        <label>À vérifier avant travaux<textarea name="controlPoint" rows={2} maxLength={2000} defaultValue={current?.controlPoint||''}/></label>
        <label>Action préventive recommandée<textarea name="actionRequest" rows={2} maxLength={2000} defaultValue={current?.actionRequest||''}/></label>
        <label>Justificatif attendu<textarea name="evidenceRequired" rows={2} maxLength={1000} defaultValue={current?.evidenceRequired||''}/></label>
        <div className="form-grid">
          <label>Type de bâtiment<select name="buildingType" defaultValue={current?.buildingType||''}><option value="">Tous</option><option>ERP</option><option>IGH</option><option>HABITATION</option><option>TERTIAIRE</option><option>AUTRE</option></select></label>
          <label>Type ERP<input name="erpType" maxLength={20} defaultValue={current?.erpType||''} placeholder="O, M, N…"/></label>
        </div>
        <label className="check-line"><input type="checkbox" name="active" defaultChecked={current?current.active:true}/><span>Règle active (proposée par le pré-contrôle)</span></label>
        <p className="muted">{RULES_DISCLAIMER}</p>
        {formErr&&<div className="notice error">{formErr}</div>}
        <div className="wizard-actions"><button type="button" className="btn secondary" onClick={()=>setEditing(null)}>Annuler</button><button className="btn" disabled={busy}>{busy?'Enregistrement...':'Enregistrer'}</button></div>
      </form>
    </div></div>}

    {removing&&<div className="modal-backdrop"><div className="modal confirm-modal" role="dialog" aria-modal="true">
      <div className="modal-head"><div><div className="eyebrow">Bibliothèque de règles</div><h2>Supprimer cette règle ?</h2></div><button className="icon-btn" onClick={()=>setRemoving(null)}>×</button></div>
      <p><strong>{removing.title}</strong></p>
      <p>La suppression est définitive. Une règle déjà utilisée par un pré-contrôle ou une observation ne peut pas être supprimée : désactivez-la.</p>
      <div className="wizard-actions"><button type="button" className="btn secondary" onClick={()=>setRemoving(null)}>Annuler</button><button type="button" className="btn danger" onClick={()=>remove(removing)}><Trash2 size={15}/>Supprimer la règle</button></div>
    </div></div>}

    {importing&&<RuleImportDialog onClose={()=>setImporting(false)} onImported={text=>{ok(text);load()}}/>}
  </>
}
