'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {useParams} from 'next/navigation';
import {ArrowLeft,DownloadCloud,RefreshCw,ListChecks,FileSearch} from 'lucide-react';
import {api,ApiReanalysisPlan,ApiReportDetail,severityLabel,statusLabel,analysisStatusLabel,ANALYSIS_STATUS_TONE} from '@/lib/api';

const SEV_TONE: Record<string,string> = { CRITICAL: 'red', HIGH: 'red', MEDIUM: 'yellow', LOW: '', INFO: '' };
const CATEGORY_LABEL: Record<string,string> = { OBSERVATION: 'Observation', NON_CONFORMITY: 'Non-conformité', RESERVATION: 'Réserve', TECHNICAL_REMARK: 'Remarque technique', RECOMMENDATION: 'Recommandation' };
const pct = (n?: number | null) => typeof n === 'number' ? `${Math.round(n * 100)}%` : '—';
const fmt = (d?: string | null) => d ? new Intl.DateTimeFormat('fr-FR').format(new Date(d)) : '—';
function friendlyError(raw?: string | null) {
  if (!raw) return null;
  try { const parsed = JSON.parse(raw); if (parsed?.error?.message) return String(parsed.error.message); } catch {}
  return raw;
}

export default function ReportDetailPage(){
  const params = useParams<{ reportId: string }>();
  const reportId = params.reportId;
  const [report, setReport] = useState<ApiReportDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'reanalyze' | 'materialize' | null>(null);
  const [msg, setMsg] = useState(''); const [isErr, setIsErr] = useState(false);
  const [plan, setPlan] = useState<ApiReanalysisPlan | null>(null);

  const load = () => { api<ApiReportDetail>(`/reports/${reportId}`).then(setReport).catch(() => setReport(null)).finally(() => setLoading(false)); };
  useEffect(() => { setLoading(true); load(); }, [reportId]);

  // A report that already has observations is never re-analysed without showing what will be kept and replaced.
  async function askReanalyze() {
    setMsg(''); setIsErr(false);
    try {
      const p = await api<ApiReanalysisPlan>(`/reports/${reportId}/reanalysis-plan`);
      if (p.total === 0) return reanalyze(false);
      setPlan(p);
    } catch (e: any) { setMsg(e.message); setIsErr(true); }
  }
  async function reanalyze(replaceUnprotected: boolean) {
    setPlan(null); setBusy('reanalyze'); setMsg(''); setIsErr(false);
    try {
      const r: any = await api(`/reports/${reportId}/reanalyze`, { method: 'POST', body: JSON.stringify({ replaceUnprotected }) });
      load();
      if (r.analysisStatus === 'FAILED') { setMsg('La nouvelle analyse a échoué. Les observations existantes ont été conservées.'); setIsErr(true); }
      else setMsg(`Analyse terminée : ${r.createdObservations ?? 0} nouvelle(s) observation(s) à valider, ${r.keptObservations ?? 0} conservée(s), ${r.replacedObservations ?? 0} remplacée(s).`);
    }
    catch (e: any) { setMsg(e.message); setIsErr(true); }
    finally { setBusy(null); }
  }
  async function materialize() {
    setBusy('materialize'); setMsg(''); setIsErr(false);
    try { const r: any = await api(`/reports/${reportId}/materialize`, { method: 'POST' }); load(); setMsg(r.alreadyMaterialized ? 'Observations déjà matérialisées.' : `${r.created ?? 0} observation(s) créée(s).`); }
    catch (e: any) { setMsg(e.message); setIsErr(true); }
    finally { setBusy(null); }
  }
  async function download() {
    const token = localStorage.getItem('sowen_access_token');
    const base = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
    const res = await fetch(`${base}/reports/${reportId}/file`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    if (!res.ok) { setMsg('Téléchargement impossible.'); setIsErr(true); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = report?.document?.name || 'rapport-bc.pdf'; a.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <><div className="card empty">Chargement…</div></>;
  if (!report) return <><div className="card"><h2>Rapport introuvable</h2><p className="muted">Aucune donnée réelle ne correspond à cet identifiant.</p></div></>;

  const statusTone = ANALYSIS_STATUS_TONE[report.analysisStatus] || 'yellow';
  const canReanalyze = report.aiConfigured && report.analysisStatus !== 'PROCESSING' && !busy;
  const canMaterialize = report.detectedObservations > 0 && report.observationCount === 0 && (report.analysisStatus === 'COMPLETED' || report.analysisStatus === 'NEEDS_REVIEW') && !busy;

  return <>
    <div className="topbar">
      <div className="title">
        <div className="eyebrow">Bureau de Contrôle · Rapport</div>
        <h1>{report.document?.name || 'Rapport BC'}</h1>
        <p>
          <Link href={`/projects/${report.projectId}`}>{report.project.name}</Link>
          {report.issuer ? ` · ${report.issuer}` : ' · Émetteur non renseigné'}
        </p>
      </div>
      <div className="actions">
        <Link className="btn secondary" href="/reports"><ArrowLeft size={16}/>← Rapports</Link>
        {report.document && <button className="btn secondary" onClick={download} disabled={busy !== null}><DownloadCloud size={16}/>Télécharger le PDF</button>}
        <button className="btn" onClick={askReanalyze} disabled={!canReanalyze} title={report.aiConfigured ? undefined : "L'analyse IA n'est pas configurée."}><RefreshCw size={16}/>Relancer l'analyse</button>
      </div>
    </div>

    {msg && <div className={isErr ? 'notice error' : 'notice'}>{msg}</div>}

    <div className="card" style={{ marginBottom: 16 }}>
      <div className="badges">
        <span className={`badge ${statusTone}`}>{analysisStatusLabel(report.analysisStatus)}</span>
        <span className="badge">{report.observationCount} observation(s) en base</span>
        <span className="badge">{report.detectedObservations} détectée(s) par l'IA</span>
        <span className="badge">{report.rawTextLength} caractères</span>
        {report.document?.sizeBytes ? <span className="badge">{(report.document.sizeBytes / 1024).toFixed(0)} Ko</span> : null}
      </div>
      <div className="detail-grid">
        <div className="detail-block"><small>Émetteur</small><p>{report.issuer || 'Non renseignée'}</p></div>
        <div className="detail-block"><small>Date d'import</small><p>{fmt(report.createdAt)}</p></div>
        <div className="detail-block"><small>Projet lié</small><p><Link href={`/projects/${report.projectId}`}>{report.project.name}</Link></p></div>
        <div className="detail-block"><small>Analyse IA configurée</small><p>{report.aiConfigured ? 'Oui' : 'Non'}</p></div>
        <div className="detail-block"><small>Fournisseur IA</small><p>{report.aiProvider || 'Claude'}</p></div>
        <div className="detail-block"><small>Modèle IA</small><p>{report.aiModel || report.configuredModel || '—'}</p></div>
        <div className="detail-block"><small>Confiance de l'analyse</small><p>{pct(report.aiConfidence)}</p></div>
      </div>
      {report.analysisError && report.analysisStatus !== 'FAILED' && <div className="detail-block" style={{ marginTop: 8 }}><small>Dernière tentative d'analyse échouée</small><p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{friendlyError(report.analysisError)}</p></div>}
    </div>

    {report.analysis && <div className="card" style={{ marginBottom: 16 }}>
      <div className="badges">
        <span className="badge">{report.analysis.documentType}</span>
        <span className={`badge ${report.analysis.isComplianceDocument ? 'green' : 'yellow'}`}>{report.analysis.isComplianceDocument ? 'Document de contrôle / construction' : 'Hors contrôle technique'}</span>
        <span className="confidence">Confiance {pct(report.analysis.confidence)}</span>
      </div>
      <h2>Analyse du document</h2>
      <p style={{ whiteSpace: 'pre-wrap' }}>{report.analysis.summary}</p>
      {report.analysis.relevance && <div className="detail-block" style={{ marginTop: 8 }}><small>Pertinence pour le suivi de conformité</small><p>{report.analysis.relevance}</p></div>}
      {report.analysis.keyInformation.length > 0 && <div className="detail-grid">
        {report.analysis.keyInformation.map((k, i) => <div className="detail-block" key={i}><small>{k.label}</small><p>{k.value}</p></div>)}
      </div>}
    </div>}

    {report.analysisStatus === 'PENDING' && <div className="notice">Analyse en attente — la clé d'analyse IA n'est pas configurée. Configurez ANTHROPIC_API_KEY côté serveur puis relancez l'analyse.</div>}
    {report.analysisStatus === 'PROCESSING' && <div className="notice">L'analyse IA de ce rapport est en cours…</div>}
    {report.analysisStatus === 'FAILED' && <div className="card failure-card">
      <h2>Échec de l'analyse</h2>
      <p>{report.failure?.message || "L'analyse a échoué pour une raison technique."}</p>
      {report.failure?.retryHint && <p className="muted">{report.failure.retryHint}</p>}
      {report.failure?.retryable && <div className="actions" style={{ margin: '12px 0' }}><button className="btn" onClick={askReanalyze} disabled={!canReanalyze}><RefreshCw size={16}/>{busy === 'reanalyze' ? 'Analyse en cours…' : "Relancer l'analyse"}</button></div>}
      {report.analysisError && <details><summary>Détail technique</summary><p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{friendlyError(report.analysisError)}</p></details>}
    </div>}
    {(report.analysisStatus === 'COMPLETED' || report.analysisStatus === 'NEEDS_REVIEW') && report.observationCount === 0 && report.detectedObservations === 0 && <div className="notice">{report.analysis ? "Document analysé — il ne contient aucune observation de conformité à suivre." : 'Analyse terminée — aucune observation détectée'}</div>}
    {(report.analysisStatus === 'COMPLETED' || report.analysisStatus === 'NEEDS_REVIEW') && report.observationCount === 0 && report.detectedObservations > 0 && <div className="notice">Aucune observation détectée par l'IA.</div>}

    {report.detectedObservations > 0 && report.observationCount === 0 && !canMaterialize && <div className="notice" style={{ marginTop: 8 }}>Des observations ont été détectées mais ne sont pas encore en base.</div>}

    {(canMaterialize) && <div className="actions" style={{ margin: '14px 0' }}>
      <button className="btn" onClick={materialize} disabled={busy !== null}><ListChecks size={16}/>Matérialiser les observations</button>
    </div>}

    <div className="section">
      <div className="section-head"><div><h2><FileSearch size={18}/>Observations</h2><p className="muted">Points extraits du rapport de contrôle.</p></div></div>
      {report.observations.length === 0
        ? <div className="card empty">Aucune observation en base pour ce rapport.</div>
        : <div className="project-list">{report.observations.map(o => (
          <div className="card" key={o.id}>
            <div className="badges">
              <span className={`badge ${SEV_TONE[o.severity] || ''}`}>{severityLabel(o.severity)}</span>
              {o.category && CATEGORY_LABEL[o.category] ? <span className="badge">{CATEGORY_LABEL[o.category]}</span> : null}
              {o.reviewStatus === 'REJECTED' ? <span className="badge red">Rejetée</span> : <span className="badge yellow">{statusLabel(o.status)}</span>}
              {o.reviewStatus === 'PENDING' && <span className="badge yellow">IA · à valider</span>}
              {o.reviewStatus === 'VALIDATED' && <span className="badge green">Validée</span>}
              {o.sourcePage ? <span className="badge">Page {o.sourcePage}</span> : null}
              {typeof o.aiConfidence === 'number' && <span className="confidence">Confiance {Math.round(o.aiConfidence * 100)}%</span>}
            </div>
            <h3>{o.title}</h3>
            {o.description !== o.title && <p>{o.description}</p>}
            <div className="detail-grid">
              <div className="detail-block"><small>Référence</small><p>{o.reference || 'Non renseignée'}</p></div>
              <div className="detail-block"><small>Action attendue</small><p>{o.requiredAction || 'Non renseignée'}</p></div>
              <div className="detail-block"><small>Lot</small><p>{o.lot ? `✓ ${o.lot.name}` : (o.suggestedLotName ? `✗ ${o.suggestedLotName} (non associé)` : 'Aucun lot')}</p></div>
              <div className="detail-block"><small>Entreprise</small><p>{o.company ? `✓ ${o.company.name}` : (o.suggestedCompanyName ? `✗ ${o.suggestedCompanyName} (non associé)` : 'Aucune entreprise')}</p></div>
            </div>
            <Link className="btn secondary" href={`/observations/${o.id}`} style={{ marginTop: 12 }}>Voir l'observation</Link>
          </div>
        ))}</div>}
    </div>

    {plan && <div className="modal-backdrop"><div className="modal">
      <div className="modal-head"><div><div className="eyebrow">Rapport</div><h2>Relancer l'analyse</h2></div><button className="icon-btn" onClick={() => setPlan(null)}>×</button></div>
      <p>Ce rapport a déjà {plan.total} observation(s). Une nouvelle analyse ne supprime jamais une observation déjà traitée.</p>
      {plan.protectedCount > 0 && <div className="detail-block"><small>Conservées telles quelles ({plan.protectedCount})</small>
        <ul className="plan-list">{plan.items.filter(i => i.protected).map(i => <li key={i.id}><strong>{i.title}</strong><span className="muted"> — {i.reasonLabels.map((label, k) => <span key={label}>{k ? ', ' : ''}{label}</span>)}</span></li>)}</ul></div>}
      {plan.replaceableCount > 0 && <div className="detail-block"><small>Remplacées par le nouveau résultat ({plan.replaceableCount})</small>
        <ul className="plan-list">{plan.items.filter(i => !i.protected).map(i => <li key={i.id}><strong>{i.title}</strong><span className="muted"> — observation IA jamais traitée</span></li>)}</ul></div>}
      <p className="muted">Les points que la nouvelle analyse détecte en plus sont ajoutés comme observations « à valider ». Si l'analyse échoue, rien n'est modifié.</p>
      <div className="wizard-actions"><button className="btn secondary" onClick={() => setPlan(null)}>Annuler</button><button className="btn" onClick={() => reanalyze(plan.replaceableCount > 0)}>{plan.replaceableCount > 0 ? `Relancer et remplacer ${plan.replaceableCount} observation(s)` : "Relancer l'analyse"}</button></div>
    </div></div>}
  </>;
}