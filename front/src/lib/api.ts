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

async function request<T>(path: string, options?: RequestInit, retry = true): Promise<T> {
  const isForm = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const token = getAccessToken();
  const headers: HeadersInit = {
    ...(isForm ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers ?? {}),
  };
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers, cache: 'no-store' });
  } catch {
    throw new Error('Impossible de joindre le serveur SOWEN. Vérifiez que le backend est démarré sur le port 4000.');
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
    let message = text;
    try { const parsed = JSON.parse(text); message = parsed.message ?? text; } catch {}
    const base = typeof message === 'string' ? message : JSON.stringify(message);
    throw new Error(base || `Erreur API (${res.status})`);
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
  reference?:string|null; status:string; severity:string; dueDate?:string|null; aiConfidence?:number|null; createdAt?:string; updatedAt?:string;
  lot?:{id:string;name:string}|null; company?:{id:string;name:string;email?:string|null}|null; report?:{id:string;issuer?:string|null}|null;
};
export type ApiRule = {id:string;domain:string;title:string;summary:string;requirement:string;actionRequest?:string|null;evidenceRequired?:string|null;severity:string;buildingType?:string|null;erpType?:string|null;lot?:{id:string;name:string}|null;source?:{id:string;title:string;reference?:string|null}|null;_count?:{versions:number}};
export type ApiDocument = {id:string;projectId:string;name:string;type:string;storageKey:string;mimeType?:string|null;sizeBytes?:number|null;uploadedAt:string};
export type ApiEmail = {id:string;projectId:string;recipientEmail?:string|null;subject:string;body:string;status:string;createdAt:string;reminderCount?:number;lastRemindedAt?:string|null;observation?:ApiObservation|null};
export type ApiCompany = {id:string;organizationId:string;name:string;email?:string|null;phone?:string|null;contactName?:string|null;_count?:{projectLots:number;observations:number}};
export type ApiLot = {id:string;name:string;code?:string|null};
