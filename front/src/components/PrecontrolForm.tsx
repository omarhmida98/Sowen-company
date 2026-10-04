'use client';
import {useEffect,useMemo,useState} from 'react';
import Link from 'next/link';
import {BookOpenCheck,CheckSquare,ChevronRight,Info} from 'lucide-react';
import {api,ApiLot,severityLabel} from '@/lib/api';
import {useSession} from '@/lib/session';
import {libraryState} from '@/lib/rule-filters';

type MatchedRule={id:string;title:string;domain:string;workType?:string|null;lot?:{id:string;name:string}|null;summary?:string|null;requirement:string;reference?:string|null;sourceDocument?:string|null;controlPoint?:string|null;actionRequest?:string|null;evidenceRequired?:string|null;severity:string};
type Match={rule:MatchedRule;score:number;reasons:{terms:{term:string;field:string;fromAi:boolean}[];lot:boolean}};
type Result={emptyLibrary:boolean;libraryActiveRules:number;evaluatedRules:number;workDescriptionId:string|null;aiUsed:boolean;terms:{fromText:string[];fromAi:string[]};matches:Match[]};
const SEV_TONE:Record<string,string>={CRITICAL:'red',HIGH:'red',MEDIUM:'yellow',LOW:'',INFO:''};
// Where in the rule a common term was found.
const FIELD:Record<string,string>={title:'titre',workType:'type de travaux',domain:'catégorie',summary:'description',requirement:'exigence',condition:'condition',controlPoint:'points à vérifier'};

// Preventive pre-control: the described works are compared with the organisation's own active rules.
// Everything shown about a match is read from the rule; when nothing matches, nothing is suggested.
export function PrecontrolForm({projectId,buildingType,erpType}:{projectId:string;buildingType?:string;erpType?:string|null}){
  const {role,can}=useSession();
  const [step,setStep]=useState(1),[lots,setLots]=useState<ApiLot[]>([]),[library,setLibrary]=useState<{total:number;active:number}|null>(null),[lotId,setLotId]=useState(''),[desc,setDesc]=useState('');
  const [busy,setBusy]=useState(false),[materializing,setMaterializing]=useState(false),[msg,setMsg]=useState(''),[isErr,setIsErr]=useState(false);
  const [result,setResult]=useState<Result|null>(null),[selected,setSelected]=useState<Record<string,boolean>>({}),[created,setCreated]=useState<any>(null);
  useEffect(()=>{api<ApiLot[]>('/lots').then(setLots).catch(()=>{});api<{total:number;active:number}>('/rules/summary').then(setLibrary).catch(()=>setLibrary({total:0,active:0}))},[]);

  async function analyze(){
    setBusy(true);setMsg('');setIsErr(false);setCreated(null);
    try{
      const r=await api<Result>('/compliance/precheck',{method:'POST',body:JSON.stringify({projectId,rawText:desc,lotId:lotId||undefined})});
      if(r.emptyLibrary){setLibrary({total:library?.total||0,active:0});return}
      setResult(r);setSelected(Object.fromEntries(r.matches.map(m=>[m.rule.id,true])));setStep(3);
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setBusy(false)}
  }
  const matches=result?.matches||[];
  const selectedIds=useMemo(()=>matches.filter(m=>selected[m.rule.id]).map(m=>m.rule.id),[result,selected]);
  async function createActions(){
    if(!result?.workDescriptionId||!selectedIds.length)return;
    setMaterializing(true);setMsg('');setIsErr(false);setCreated(null);
    try{
      const r:any=await api('/compliance/materialize',{method:'POST',body:JSON.stringify({workDescriptionId:result.workDescriptionId,ruleIds:selectedIds})});
      setCreated(r);setMsg(`${r.observationsCreated||0} observation(s) créée(s).${r.alreadyExisting?` ${r.alreadyExisting} règle(s) avaient déjà une observation ouverte sur ce projet : aucune n’a été créée en double.`:''}`);
    }catch(e:any){setMsg(e.message);setIsErr(true)}finally{setMaterializing(false)}
  }

  if(!role||!library)return null;
  const state=libraryState(library);
  if(state!=='READY')return <div className="card empty-library" data-library={state}>
    <h2>{state==='EMPTY'?'Aucune règle dans votre bibliothèque':'Aucune règle active dans votre bibliothèque'}</h2>
    <p>Le pré-contrôle compare les travaux que vous décrivez aux règles actives de votre organisation. Sans règle active, il ne peut rien proposer : SOWEN ne formule aucune recommandation en dehors de vos règles.</p>
    {can('rule.write')?<div className="actions"><Link className="btn" href="/rules"><BookOpenCheck size={16}/>{state==='EMPTY'?'Ajouter ou importer des règles':'Gérer les règles'}</Link></div>
      :<p className="muted">Demandez à un administrateur ou à un éditeur de votre organisation d’ajouter ou d’activer des règles.</p>}
  </div>;
  if(!can('precontrol.run'))return <div className="card empty" data-precontrol="read-only">Votre rôle permet de consulter les règles et les observations. Le pré-contrôle est lancé par un administrateur ou un éditeur.</div>;

  return <div className="stack"><div className="card wizard">
    <div className="steps"><span className={step>=1?'active':''}>1. Contexte</span><span className={step>=2?'active':''}>2. Travaux</span><span className={step>=3?'active':''}>3. Règles correspondantes</span></div>
    {step===1&&<div><h2>Contexte du projet</h2><p className="muted">Seules les règles compatibles avec ce contexte sont comparées. Choisir un lot ajoute les règles rattachées à ce lot.</p><div className="form-grid"><label>Type de bâtiment<input value={buildingType||'—'} disabled/></label><label>Type ERP<input value={erpType||'—'} disabled/></label><label>Lot principal<select value={lotId} onChange={e=>setLotId(e.target.value)}><option value="">Tous les lots</option>{lots.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div><div className="wizard-actions"><button className="btn" onClick={()=>setStep(2)}>Continuer <ChevronRight size={16}/></button></div></div>}
    {step===2&&<div><h2>Décrivez les travaux prévus</h2><p className="muted"><span>SOWEN compare votre description aux</span> <strong>{library.active}</strong> <span>règle(s) active(s) de votre bibliothèque.</span></p><label>Description<textarea rows={8} value={desc} onChange={e=>setDesc(e.target.value)} placeholder="Décrire précisément les travaux : ouvrages, équipements, matériaux, locaux concernés…"/></label>{msg&&<div className="notice error">{msg}</div>}<div className="wizard-actions"><button className="btn secondary" onClick={()=>setStep(1)}>Retour</button><button className="btn" disabled={!desc.trim()||busy} onClick={analyze}>{busy?'Analyse...':'Lancer le pré-contrôle'}</button></div></div>}
    {step===3&&result&&<div>
      <div className="analysis-ready" data-matches={matches.length}><Info size={38}/><h2><span>{matches.length}</span> <span>règle(s) de votre bibliothèque correspondent</span></h2><p className="muted"><span>{result.evaluatedRules}</span> <span>règle(s) active(s) comparée(s).</span> {result.aiUsed?<span>L’IA a seulement normalisé le vocabulaire de votre description ; elle n’a rédigé aucune recommandation.</span>:<span>Comparaison faite sur les mots de votre description.</span>}</p></div>
      <div className="card precontrol-terms"><small>Termes utilisés pour la comparaison</small><div className="badges">{result.terms.fromText.map(t=><span className="badge" key={`t-${t}`}>{t}</span>)}{result.terms.fromAi.map(t=><span className="badge blue" key={`a-${t}`} title="Terme ajouté par la normalisation IA">{t}</span>)}{result.terms.fromText.length+result.terms.fromAi.length===0&&<span className="muted">Aucun terme significatif dans la description.</span>}</div>{result.terms.fromAi.length>0&&<p className="muted">En bleu : synonymes proposés par la normalisation IA.</p>}</div>
      {matches.length===0?<div className="notice" data-precontrol="no-match"><strong>Aucune règle de votre bibliothèque ne correspond à ces travaux.</strong> <span>SOWEN ne propose aucune recommandation en dehors de vos règles. Précisez la description, choisissez un lot, ou complétez la bibliothèque.</span>{can('rule.write')&&<> <Link className="text-link" href="/rules">Gérer les règles</Link></>}</div>
      :<div className="stack">{matches.map(({rule:r,reasons})=><div className="card rule match" key={r.id} data-match={r.title}>
        <div className="actions" style={{justifyContent:'space-between'}}><div className="badges"><span className={`badge ${SEV_TONE[r.severity]||''}`}>{severityLabel(r.severity)}</span><span className="badge">{r.domain}</span><span className="badge">{r.lot?.name||'Tous les lots'}</span></div><label className="check-line"><input type="checkbox" checked={!!selected[r.id]} onChange={e=>setSelected(s=>({...s,[r.id]:e.target.checked}))}/><span>Créer une observation</span></label></div>
        <div className="eyebrow">Règle correspondante</div><h3>{r.title}</h3>
        <div className="detail-block why"><small>Pourquoi cette règle</small>{reasons.terms.length>0&&<p><span>Termes communs avec votre description :</span> {reasons.terms.map((t,i)=><span key={t.term+t.field}>{i?', ':''}<strong>{t.term}</strong> (<span>{FIELD[t.field]||t.field}</span>{t.fromAi&&<>, <span>terme normalisé</span></>})</span>)}</p>}{reasons.lot&&<p><span>Règle rattachée au lot sélectionné</span>{r.lot?` (${r.lot.name})`:''}.</p>}</div>
        <div className="detail-block"><small>Exigence</small><p>{r.requirement}</p></div>
        <div className="detail-block"><small>Référence / source</small><p>{r.reference||r.sourceDocument?<>{r.reference||''}{r.reference&&r.sourceDocument?' — ':''}{r.sourceDocument||''}</>:<span className="muted">Aucune référence renseignée dans cette règle.</span>}</p></div>
        <div className="detail-block"><small>À vérifier avant travaux</small><p>{r.controlPoint||<span className="muted">Non renseigné dans cette règle.</span>}</p></div>
        <div className="detail-block"><small>Action préventive recommandée</small><p>{r.actionRequest||<span className="muted">Non renseignée dans cette règle.</span>}</p></div>
        {r.evidenceRequired&&<div className="detail-block"><small>Justificatif attendu</small><p>{r.evidenceRequired}</p></div>}
      </div>)}</div>}
      <p className="muted">Les règles affichées proviennent de la bibliothèque de votre organisation ; leur contenu n’est pas vérifié par SOWEN.</p>
      {msg&&<div className={isErr?'notice error':'notice success'}>{msg}</div>}
      {created&&<div className="card" data-created><h3>Observations générées</h3><div className="kv"><span>Observations créées</span><strong>{created.observationsCreated||0}</strong></div><div className="kv"><span>Déjà existantes (non dupliquées)</span><strong>{created.alreadyExisting||0}</strong></div><div className="kv"><span>Brouillons prêts à envoyer</span><strong>{created.draftsCreated||0}</strong></div><div className="kv"><span>Destinataires à compléter</span><strong>{created.needsRecipient||0}</strong></div><div className="actions"><Link className="btn secondary" href={`/projects/${projectId}/observations`}>Voir les observations du projet</Link></div></div>}
      <div className="wizard-actions"><button className="btn secondary" onClick={()=>{setStep(2);setMsg('')}}>Modifier la description</button>{matches.length>0&&<button className="btn" disabled={!selectedIds.length||materializing||!!created} onClick={createActions}><CheckSquare size={16}/>{materializing?'Création...':`Créer ${selectedIds.length} observation(s)`}</button>}</div>
    </div>}
  </div></div>;
}
