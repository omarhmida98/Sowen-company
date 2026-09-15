'use client';
import { useEffect, useMemo, useState } from 'react';
import { CheckSquare, ChevronRight, Info, TriangleAlert } from 'lucide-react';
import { api, ApiLot, ApiRule } from '@/lib/api';

export function PrecontrolForm({ projectId, buildingType, erpType }: { projectId: string; buildingType?: string; erpType?: string | null }) {
  const [step, setStep] = useState(1);
  const [lots, setLots] = useState<ApiLot[]>([]);
  const [lotId, setLotId] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [materializing, setMaterializing] = useState(false);
  const [msg, setMsg] = useState('');
  const [rules, setRules] = useState<ApiRule[]>([]);
  const [context, setContext] = useState<any>(null);
  const [ai, setAi] = useState(false);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiConfidence, setAiConfidence] = useState<number | null>(null);
  const [workDescriptionId, setWorkDescriptionId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [created, setCreated] = useState<any>(null);

  useEffect(() => { api<ApiLot[]>('/lots').then(setLots).catch(() => {}); }, []);

  async function analyze() {
    setBusy(true); setMsg(''); setCreated(null);
    try {
      const r: any = await api('/compliance/precheck', { method: 'POST', body: JSON.stringify({ projectId, rawText: desc, lotId: lotId || undefined }) });
      const nextRules = r.rules || [];
      setRules(nextRules);
      setSelected(Object.fromEntries(nextRules.map((x: ApiRule) => [x.id, true])));
      setContext(r.structuredContext || null);
      setAi(!!r.aiConfigured);
      setAiModel(r.aiModel || null);
      setAiConfidence(typeof r.aiConfidence === 'number' ? r.aiConfidence : null);
      setWorkDescriptionId(r.workDescriptionId || null);
      setStep(3);
    } catch (e: any) { setMsg(e.message); }
    finally { setBusy(false); }
  }

  const selectedIds = useMemo(() => rules.filter(r => selected[r.id]).map(r => r.id), [rules, selected]);

  async function createActions() {
    if (!workDescriptionId || !selectedIds.length) return;
    setMaterializing(true); setMsg(''); setCreated(null);
    try {
      const result: any = await api('/compliance/materialize', {
        method: 'POST',
        body: JSON.stringify({ workDescriptionId, ruleIds: selectedIds }),
      });
      setCreated(result);
      setMsg(`${result.observationsCreated || 0} action(s) entreprise créée(s).`);
    } catch (e: any) { setMsg(e.message); }
    finally { setMaterializing(false); }
  }

  const confidence = aiConfidence !== null ? Math.round(aiConfidence * 100) : null;
  return <div className="stack"><div className="card wizard">
    <div className="steps"><span className={step >= 1 ? 'active' : ''}>1. Contexte</span><span className={step >= 2 ? 'active' : ''}>2. Travaux</span><span className={step >= 3 ? 'active' : ''}>3. Analyse</span></div>
    {step === 1 && <div><h2>Contexte réglementaire</h2><p className="muted">Le contexte du projet est déjà connu par SOWEN.</p><div className="form-grid"><label>Type de bâtiment<input value={buildingType || '—'} disabled /></label><label>Type ERP<input value={erpType || '—'} disabled /></label><label>Lot principal<select value={lotId} onChange={e => setLotId(e.target.value)}><option value="">Tous les lots</option>{lots.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label></div><div className="wizard-actions"><button className="btn" onClick={() => setStep(2)}>Continuer <ChevronRight size={16} /></button></div></div>}
    {step === 2 && <div><h2>Décris les travaux prévus</h2><p className="muted">SOWEN structure la description avec l’IA puis la compare aux règles réellement enregistrées dans PostgreSQL.</p><label>Description<textarea rows={8} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Décrire précisément les travaux…" /></label>{msg && <div className="notice error">{msg}</div>}<div className="wizard-actions"><button className="btn secondary" onClick={() => setStep(1)}>Retour</button><button className="btn" disabled={!desc.trim() || busy} onClick={analyze}>{busy ? 'Analyse...' : 'Lancer le pré-contrôle'}</button></div></div>}
    {step === 3 && <div><div className="analysis-ready"><Info size={38} /><h2>{rules.length} règle(s) applicable(s) à confirmer</h2><p className="muted">Le moteur filtre la base selon le projet. {ai ? 'L’IA a également structuré les risques, documents et consignes.' : 'Ajoute OPENAI_API_KEY pour enrichir cette analyse par IA.'}</p>{aiModel && <small>Modèle : {aiModel}{confidence !== null ? ` · confiance contexte ${confidence}%` : ''}</small>}</div>
      {confidence !== null && confidence < 75 && <div className="notice warning"><TriangleAlert size={18} />Confiance IA limitée. Les résultats doivent être vérifiés par un utilisateur compétent avant d’être transmis.</div>}
      {context && <div className="card"><div className="two"><div><h3>Risques détectés</h3>{(context.risks || []).length ? (context.risks || []).map((x: string) => <div className="integration" key={x}>{x}</div>) : <p className="muted">Aucun risque explicite extrait.</p>}</div><div><h3>Documents requis</h3>{(context.documentsRequired || []).length ? (context.documentsRequired || []).map((x: string) => <div className="integration" key={x}>{x}</div>) : <p className="muted">Aucun document explicite extrait.</p>}</div></div><h3>Instructions entreprise</h3>{(context.contractorInstructions || []).length ? (context.contractorInstructions || []).map((x: string) => <div className="integration" key={x}>{x}</div>) : <p className="muted">Aucune instruction supplémentaire extraite.</p>}</div>}
      <div className="stack">{rules.length === 0 ? <div className="notice">Aucune règle correspondante dans la base actuelle.</div> : rules.map(r => <div className="card rule" key={r.id}>
        <div className="actions" style={{ justifyContent: 'space-between' }}><div className="badges"><span className="badge">{r.severity}</span><span className="badge">{r.domain}</span></div><label className="check-line"><input type="checkbox" checked={!!selected[r.id]} onChange={e => setSelected(s => ({ ...s, [r.id]: e.target.checked }))} />Créer une action</label></div>
        <h3>{r.title}</h3><p>{r.summary}</p><div className="detail-block"><small>Exigence</small><p>{r.requirement}</p></div><div className="detail-block"><small>Action entreprise</small><p>{r.actionRequest || '—'}</p></div>
      </div>)}</div>
      {msg && <div className={created ? 'notice success' : 'notice'}>{msg}</div>}
      {created && <div className="card"><h3>Actions générées</h3><div className="kv"><span>Observations créées</span><strong>{created.observationsCreated || 0}</strong></div><div className="kv"><span>Brouillons prêts à envoyer</span><strong>{created.draftsCreated || 0}</strong></div><div className="kv"><span>Destinataires à compléter</span><strong>{created.needsRecipient || 0}</strong></div>{created.dueDate && <div className="kv"><span>Échéance proposée</span><strong>{new Date(created.dueDate).toLocaleDateString('fr-FR')}</strong></div>}</div>}
      <div className="wizard-actions"><button className="btn secondary" onClick={() => setStep(2)}>Modifier</button>{rules.length > 0 && <button className="btn" disabled={!selectedIds.length || materializing || !!created} onClick={createActions}><CheckSquare size={16} />{materializing ? 'Création...' : `Créer ${selectedIds.length} action(s) entreprise`}</button>}</div>
    </div>}
  </div></div>;
}
