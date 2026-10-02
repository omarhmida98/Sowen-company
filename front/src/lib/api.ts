const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type SessionPayload = {
  user?: unknown;
  accessToken: string;
  refreshToken: string;
};

function isBrowser() { return typeof window !== 'undefined'; }
function getAccessToken() { return isBrowser() ? localStorage.getItem('sowen_access_token') : null; }
function getRefreshToken() { return isBrowser() ? localStorage.getItem('sowen_refresh_token') : null; }
function saveSession(payload: SessionPayload) {
  if (!isBrowser()) return;
  localStorage.setItem('sowen_access_token', payload.accessToken);
  localStorage.setItem('sowen_refresh_token', payload.refreshToken);
  if (payload.user) localStorage.setItem('sowen_user', JSON.stringify(payload.user));
}
export function clearSession() {
  if (!isBrowser()) return;
  localStorage.removeItem('sowen_access_token');
  localStorage.removeItem('sowen_refresh_token');
  localStorage.removeItem('sowen_user');
}

export class SowenError extends Error {
  isErr = true;
}

const FRIENDLY_BY_STATUS: Record<number, string> = {
  400: 'Les informations saisies sont incomplètes ou invalides.',
  401: 'Votre session a expiré. Merci de vous reconnecter.',
  403: 'Vous n’avez pas les droits pour effectuer cette action.',
  404: 'Élément introuvable. Il a peut-être été supprimé ou déplacé.',
  409: 'Un élément identique existe déjà.',
  422: 'Certaines informations sont invalides. Vérifiez puis réessayez.',
  429: 'Trop de demandes. Patientez quelques secondes puis réessayez.',
};
const GENERIC_ERROR = 'Une erreur est survenue. Merci de réessayer dans quelques instants.';
const OFFLINE_ERROR = 'Impossible de joindre le service SOWEN. Vérifiez votre connexion internet puis réessayez.';

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Brouillon',
  IN_ANALYSIS: 'En analyse',
  ACTIVE: 'Actif',
  CLOSED: 'Clôturé',
  ARCHIVED: 'Archivé',
  OPEN: 'Ouverte',
  TO_SEND: 'À envoyer',
  SENT: 'Envoyé',
  DELIVERED: 'Délivré',
  OPENED: 'Lu',
  WAITING: 'En attente',
  TO_RELAUNCH: 'À relancer',
  RESOLVED: 'Clôturé',
  BLOCKED: 'Bloqué',
  ERROR: 'Erreur',
  NEEDS_RECIPIENT: 'Destinataire manquant',
  PENDING: 'En attente',
  PROCESSING: 'En cours',
  COMPLETED: 'Terminé',
  NEEDS_REVIEW: 'À valider',
  FAILED: 'Échec',
  APPROVED: 'Validé',
  REJECTED: 'Refusé',
};
const SEVERITY_LABELS: Record<string, string> = {
  INFO: 'Information',
  LOW: 'Faible',
  MEDIUM: 'Moyenne',
  HIGH: 'Élevée',
  CRITICAL: 'Critique',
};
const KIND_LABELS: Record<string, string> = {
  OVERDUE: 'Échéance dépassée',
  DUE_SOON: 'Échéance proche',
  ESCALATION: 'Escalade',
  EMAIL: 'Email',
  EVIDENCE: 'Justificatif',
  INFO: 'Information',
};
const DOC_TYPE_LABELS: Record<string, string> = {
  CONTROL_REPORT: 'Rapport BC',
  PLAN: 'Plan',
  EVIDENCE: 'Justificatif',
  TECHNICAL_NOTE: 'Note technique',
  OTHER: 'Autre',
  BEFORE: 'Photo avant',
  AFTER: 'Photo après',
  PHOTO: 'Photo',
  PV: 'PV',
  CERTIFICATE: 'Certificat',
  TECHNICAL_SHEET: 'Fiche technique',
  VOICE_NOTE: 'Note vocale',
};
export function statusLabel(v?: string | null) { return STATUS_LABELS[v || ''] || (v && v.length < 40 ? v : '—'); }
export function severityLabel(v?: string | null) { return SEVERITY_LABELS[v || ''] || '—'; }
const ANALYSIS_STATUS_LABELS: Record<string, string> = {
  PENDING: 'Analyse en attente',
  PROCESSING: 'Analyse en cours',
  COMPLETED: 'Analyse terminée',
  NEEDS_REVIEW: 'Analyse à valider',
  FAILED: 'Échec de l’analyse',
};
export function analysisStatusLabel(v?: string | null) { return ANALYSIS_STATUS_LABELS[v || ''] || (v && v.length < 40 ? v : '—'); }
export const ANALYSIS_STATUS_TONE: Record<string, string> = { PENDING: 'yellow', PROCESSING: 'yellow', COMPLETED: 'green', NEEDS_REVIEW: 'yellow', FAILED: 'red' }; 
export function kindLabel(v?: string | null) { return KIND_LABELS[v || ''] || (v || '—'); }
export function docTypeLabel(v?: string | null) { return DOC_TYPE_LABELS[v || ''] || (v || 'Autre'); }

function looksBusiness(message: string): boolean {
  const t = (message || '').trim();
  if (!t || t.length > 300) return false;
  if (/<[!a-z]|<\/|\[object /i.test(t)) return false;
  if (/\{.*\}|\[.*\]/.test(t)) return false;
  if (/\b(http[s]?:\/\/|localhost|127\.0\.0\.1|\.env|postgres|sqlite|database|ngrok|API|bearer|jwt|token|:4000|:3001)\b/i.test(t)) return false;
  if (/^[A-Z][A-Z0-9_]{2,}$/.test(t)) return false;
  return true;
}

async function request<T>(path: string, options?: RequestInit, retry = true): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const token = getAccessToken();
  const headers: HeadersInit = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers ?? {}),
    'ngrok-skip-browser-warning': 'true',
  };
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
  } catch {
    console.error(`[SOWEN] ${options?.method ?? 'GET'} ${path} → réseau indisponible`);
    throw new SowenError(OFFLINE_ERROR);
  }

  if (res.status === 401 && retry && isBrowser() && path !== '/auth/login' && path !== '/auth/register' && path !== '/auth/refresh') {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
        cache: 'no-store',
      });
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json() as SessionPayload;
        saveSession(refreshed);
        return request<T>(path, options, false);
      }
    }
    clearSession();
    if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/register') && !location.pathname.startsWith('/portal/')) {
      location.href = '/login';
    }
  }

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch {}
    const serverMessage =
      parsed && typeof parsed === 'object' && 'message' in parsed && typeof (parsed as { message?: unknown }).message === 'string'
        ? (parsed as { message: string }).message
        : typeof parsed === 'string' ? parsed : (text || '');
    console.error(`[SOWEN] ${options?.method ?? 'GET'} ${path} → ${res.status}:`, serverMessage);
    const friendly = FRIENDLY_BY_STATUS[res.status] ?? GENERIC_ERROR;
    throw new SowenError(looksBusiness(serverMessage) ? serverMessage : friendly);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  return request<T>(path, options, true);
}

export async function safeApi<T>(path: string, fallback: T): Promise<T> {
  try { return await api<T>(path); } catch { return fallback; }
}

export type ApiProject = {
  id:string; organizationId?:string; name:string; address?:string|null; buildingType:string; erpType?:string|null; status:string;
  lots?: Array<{id:string; contactEmail?:string|null; lot:{id:string;name:string}; company?:{id:string;name:string;email?:string|null}|null}>;
  observations?: ApiObservation[]; documents?: ApiDocument[]; reports?: Array<{id:string;issuer?:string|null;createdAt?:string|null}>;
  _count?: {observations:number;documents:number};
};
export type ApiObservation = {
  id:string; projectId:string; title?:string|null; description?:string|null; originalText?:string|null; requiredAction?:string|null;
  reference?:string|null; status:string; severity:string; sourcePage?:number|null; dueDate?:string|null; aiConfidence?:number|null; escalationLevel?:number|null; createdAt?:string; updatedAt?:string;
  lot?:{id:string;name:string}|null; company?:{id:string;name:string;email?:string|null}|null; report?:{id:string;issuer?:string|null}|null;
  suggestedLotName?:string|null; suggestedCompanyName?:string|null; category?:string|null;
};
export type ApiDocumentAnalysis = {
  documentType:string; isComplianceDocument:boolean; summary:string; relevance:string; confidence:number|null;
  keyInformation:{label:string;value:string}[];
};
export type ApiReportDetail = {
  id:string; projectId:string;
  project:{id:string;name:string;buildingType?:string|null;status?:string};
  document?:{id:string;name:string;storageKey:string;mimeType?:string|null;sizeBytes?:number|null;uploadedAt?:string}|null;
  issuer?:string|null; reportDate?:string|null; createdAt?:string; analyzedAt?:string|null;
  analysisStatus:string; analysisError?:string|null; aiModel?:string|null; aiConfidence?:number|null;
  observationCount:number; rawTextLength:number; aiConfigured:boolean; aiProvider?:string; configuredModel?:string; analysis?:ApiDocumentAnalysis|null; detectedObservations:number; observations: ApiObservation[];
};
export type ApiRule = {id:string;domain:string;title:string;summary:string;requirement:string;actionRequest?:string|null;evidenceRequired?:string|null;severity:string;buildingType?:string|null;erpType?:string|null;lot?:{id:string;name:string}|null;source?:{id:string;title:string;reference?:string|null}|null;_count?:{versions:number}};
export type ApiDocument = {id:string;projectId:string;name:string;type:string;storageKey:string;mimeType?:string|null;sizeBytes?:number|null;uploadedAt:string};
export type ApiSendContext = {
  observation:{id:string;title:string;description:string;reference?:string|null;requiredAction?:string|null;severity:string;status:string;sourcePage?:number|null;dueDate?:string|null;companyId?:string|null;
    project:{id:string;name:string};lot?:{id:string;name:string}|null;report?:{id:string;name?:string|null;issuer?:string|null}|null};
  companies:{id:string;name:string;email?:string|null;contactName?:string|null}[];
  selectedCompanyId:string|null;
  draft:{subject:string;body:string};
  savedDraft:{id:string;subject:string;body:string;recipientEmail?:string|null;status:string;userEdited:boolean}|null;
  lastSent:{id:string;recipientEmail?:string|null;sentAt?:string|null;companyName?:string|null}|null;
  emailConfigured:boolean;
};
export type ApiEmail ={id:string;projectId:string;recipientEmail?:string|null;subject:string;body:string;status:string;createdAt:string;reminderCount?:number;lastRemindedAt?:string|null;observation?:ApiObservation|null};
export type ApiCompany = {id:string;organizationId:string;name:string;email?:string|null;phone?:string|null;contactName?:string|null;_count?:{projectLots:number;observations:number}};
export type ApiLot = {id:string;name:string;code?:string|null};
