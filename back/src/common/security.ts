import { trustProxyHops } from '../config.validation';

type Env = Record<string, unknown>;
const text = (v: unknown) => String(v ?? '').trim();

// Origins allowed to call the API from a browser (WEB_URL, comma separated).
export function allowedOrigins(env: Env): string[] {
  return (text(env.WEB_URL) || 'http://localhost:3000').split(',').map(s => s.trim().replace(/\/+$/, '')).filter(Boolean);
}

// Where the API listens. API_HOST decides when set. Otherwise, as soon as a reverse proxy is trusted (TRUST_PROXY),
// the API only listens on the loopback interface: a client reaching it directly could forge X-Forwarded-For and
// escape the sign-in limits. In a container set API_HOST="0.0.0.0" and publish the port on 127.0.0.1 only.
export function listenHost(env: Env): string {
  return text(env.API_HOST) || (trustProxyHops(env.TRUST_PROXY) > 0 ? '127.0.0.1' : '0.0.0.0');
}

// HSTS is only sent by a production installation served over HTTPS.
export function hstsEnabled(env: Env): boolean {
  return text(env.NODE_ENV).toLowerCase() === 'production' && /^https:\/\//i.test(text(env.PUBLIC_APP_URL));
}

// Headers of every API response. The API only serves JSON and file downloads (as attachments): nothing it returns
// may be framed, sniffed as another type or run as a document.
export function apiSecurityHeaders(env: Env): Record<string, string> {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'Cache-Control': 'no-store',
    ...(hstsEnabled(env) ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}),
  };
}
