import { createHmac, timingSafeEqual } from 'crypto';

// Company portal links. The database stores no token at all: a link is "<access id>.<signature>", where the
// signature is an HMAC of the access id made with a server secret. Reading the database therefore never gives a
// usable link, and the server can still rebuild the link of an active access to put it in an email or show it
// to an administrator.
//
// The signing key is PORTAL_TOKEN_SECRET, a secret of its own: it has nothing to do with the JWT secrets, so
// rotating those does not touch portal links. Rotating PORTAL_TOKEN_SECRET invalidates every portal link already
// sent; new ones are obtained by regenerating the access or sending a new email.

export const PORTAL_SECRET_MIN_LENGTH = 24;
export type PortalSecret = { secret: string; source: 'configured' | 'development-fallback' };

// PORTAL_TOKEN_SECRET is required as soon as the installation is a real one: NODE_ENV=production, or a public
// address (PUBLIC_APP_URL) under which portal links are emailed to companies.
export function portalSecretRequired(env: { NODE_ENV?: unknown; PUBLIC_APP_URL?: unknown }): boolean {
  return String(env.NODE_ENV ?? '').trim().toLowerCase() === 'production' || Boolean(String(env.PUBLIC_APP_URL ?? '').trim());
}

// Which key signs portal links.
// - PORTAL_TOKEN_SECRET set: that key, always.
// - not set, on a real installation (see above): none. Portal links cannot be made or checked, and the API refuses
//   to start (config.validation.ts), so a missing secret is never papered over in production.
// - not set, in local development: a key derived from JWT_ACCESS_SECRET, so the portal works out of the box. It is
//   still a secret, but it changes with the JWT secret; that is acceptable only for development.
export function portalSecret(env: { PORTAL_TOKEN_SECRET?: unknown; JWT_ACCESS_SECRET?: unknown; NODE_ENV?: unknown; PUBLIC_APP_URL?: unknown }): PortalSecret | null {
  const configured = String(env.PORTAL_TOKEN_SECRET ?? '').trim();
  if (configured) return { secret: configured, source: 'configured' };
  if (portalSecretRequired(env)) return null;
  const jwt = String(env.JWT_ACCESS_SECRET ?? '').trim();
  return jwt ? { secret: `sowen-portal-development:${jwt}`, source: 'development-fallback' } : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const signature = (accessId: string, secret: string) => createHmac('sha256', `sowen-portal-link:${secret}`).update(accessId).digest('base64url');

export function portalToken(accessId: string, secret: string): string {
  return `${accessId}.${signature(accessId, secret)}`;
}

// Returns the access id when the token is well formed and correctly signed, otherwise null.
// Whether the access still exists, is revoked or has expired is checked by the caller.
export function verifyPortalToken(token: unknown, secret: string): string | null {
  if (typeof token !== 'string' || token.length > 120) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const id = token.slice(0, dot), given = Buffer.from(token.slice(dot + 1));
  if (!UUID.test(id)) return null;
  const expected = Buffer.from(signature(id, secret));
  return given.length === expected.length && timingSafeEqual(given, expected) ? id : null;
}

export type AccessState = 'ACTIVE' | 'EXPIRED' | 'REVOKED';
export function accessState(access: { revokedAt: Date | null; expiresAt: Date | null }, now = new Date()): AccessState {
  if (access.revokedAt) return 'REVOKED';
  if (access.expiresAt && access.expiresAt.getTime() <= now.getTime()) return 'EXPIRED';
  return 'ACTIVE';
}

// PORTAL_ACCESS_TTL_DAYS: validity of a new portal access (default 90 days). 0 means no expiry.
export function portalTtlDays(raw: unknown): number {
  const text = String(raw ?? '').trim();
  if (!text) return 90;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 90;
}

// What the company sees instead of the internal workflow status.
export type CompanyStatus = 'ACTION_REQUIRED' | 'UNDER_REVIEW' | 'CLOSED';
export function companyStatus(status: string): CompanyStatus {
  if (status === 'RESOLVED') return 'CLOSED';
  return status === 'WAITING' ? 'UNDER_REVIEW' : 'ACTION_REQUIRED';
}

// Replaces the token of a portal or invitation URL before it is written to a log or echoed in an error.
export function redactTokens(url: string): string {
  return String(url || '').replace(/(\/(?:portal|invitation|emails\/resolve)\/)(?!access(?:\/|\?|$))[^/?#]+/g, '$1[redacted]');
}
