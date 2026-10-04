// HTTP security headers of the web application. Used by next.config.ts and unit-tested (front/test).

const origin = (url: string) => { try { return new URL(url).origin; } catch { return null; } };

// Content-Security-Policy of the pages.
//  - scripts and styles: this site only. Inline ones are allowed because Next.js writes its start-up data, and the
//    theme/language bootstrap, as inline scripts; no script can be loaded from another site.
//  - connect-src: this site and the API only, so a page cannot send data anywhere else.
//  - no plugin, no framing by another site, forms only post to this site.
export function contentSecurityPolicy({ apiUrl, development = false }: { apiUrl?: string; development?: boolean } = {}): string {
  const api = origin(apiUrl || 'http://localhost:4000/api');
  const connect = ["'self'", ...(api ? [api] : []), ...(development ? ['ws:', 'wss:'] : [])];
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connect.join(' ')}`,
    "object-src 'none'",
    "frame-src 'self' blob:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

// HSTS is only sent by a production build whose public address is https.
export function securityHeaders({ apiUrl, development = false, https = false }: { apiUrl?: string; development?: boolean; https?: boolean } = {}): { key: string; value: string }[] {
  return [
    { key: 'Content-Security-Policy', value: contentSecurityPolicy({ apiUrl, development }) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), geolocation=(), microphone=(), payment=(), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    ...(https && !development ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000' }] : []),
  ];
}
