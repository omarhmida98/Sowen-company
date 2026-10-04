import { PORTAL_SECRET_MIN_LENGTH, portalSecretRequired } from './portal/portal-tokens';

const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;
// Length of a secret on a real installation. tools/generate-secrets.ps1 produces 64 characters.
export const PRODUCTION_SECRET_MIN_LENGTH = 32;
// The password of the development database in docker-compose.yml: public, since it is in the repository.
const DEV_DATABASE_PASSWORD = 'sowen_dev_password';

// A real installation: NODE_ENV="production", or a public address (PUBLIC_APP_URL) under which links are emailed.
// The same rule decides that PORTAL_TOKEN_SECRET is required.
export function isRealInstallation(config: { NODE_ENV?: unknown; PUBLIC_APP_URL?: unknown }): boolean {
  return portalSecretRequired(config);
}

// Values copied from an example file or typed as a stand-in. They are published, so they protect nothing.
export function looksLikePlaceholder(value: unknown): boolean {
  const v = String(value ?? '').trim();
  if (!v) return false;
  return /change[\s_-]*me|changeme|placeholder|example|sample|your[\s_-]*(secret|key|password)|replace[\s_-]*(me|this)|to[\s_-]*be[\s_-]*(defined|changed)|^(secret|password|test|dev|default|todo|xxx+)[\s_-]*$|long[\s_-]*random|random[\s_-]*(value|secret)/i.test(v);
}

// What is wrong with a secret on a real installation, or null.
export function secretProblem(value: unknown): string | null {
  const v = String(value ?? '').trim();
  if (looksLikePlaceholder(v)) return 'is an example or placeholder value';
  if (v.length < PRODUCTION_SECRET_MIN_LENGTH) return `must contain at least ${PRODUCTION_SECRET_MIN_LENGTH} characters`;
  if (new Set(v).size < 12) return 'is not random enough';
  return null;
}

// TRUST_PROXY: empty (no proxy) or the number of reverse proxies in front of the API.
export function trustProxyHops(raw: unknown): number {
  const text = String(raw ?? '').trim();
  return /^\d+$/.test(text) ? Number(text) : 0;
}

const GENERATE = 'Generate new values with tools/generate-secrets.ps1 (or: openssl rand -base64 48).';

export function validateEnvironment(config: Record<string, unknown>, warn: (message: string) => void = message => console.warn(`[SOWEN] ${message}`)) {
  const missing = REQUIRED.filter((key) => !String(config[key] ?? '').trim());
  if (missing.length) {
    throw new Error(`Missing required environment variable(s): ${missing.join(', ')}`);
  }

  const access = String(config.JWT_ACCESS_SECRET ?? '');
  const refresh = String(config.JWT_REFRESH_SECRET ?? '');
  if (access.length < 24 || refresh.length < 24) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must each contain at least 24 characters.');
  }
  if (access === refresh) {
    throw new Error('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different.');
  }

  // Company portal links are signed with their own secret, separate from the JWT secrets.
  const portal = String(config.PORTAL_TOKEN_SECRET ?? '').trim();
  if (portal) {
    if (portal.length < PORTAL_SECRET_MIN_LENGTH) throw new Error(`PORTAL_TOKEN_SECRET must contain at least ${PORTAL_SECRET_MIN_LENGTH} characters.`);
    if (portal === access || portal === refresh) throw new Error('PORTAL_TOKEN_SECRET must be different from JWT_ACCESS_SECRET and JWT_REFRESH_SECRET.');
  } else if (portalSecretRequired(config)) {
    throw new Error('PORTAL_TOKEN_SECRET must be configured: company portal links are signed with it. It is required when NODE_ENV="production" or when PUBLIC_APP_URL is set (portal links are then emailed to companies). Generate a random value of at least 24 characters, different from the JWT secrets.');
  }

  // The external cron endpoint is only enabled when CRON_SECRET is set. Leave it empty when no external scheduler
  // calls it: the hourly scan runs inside the API.
  const cron = String(config.CRON_SECRET ?? '').trim();
  if (cron && [access, refresh, portal].includes(cron)) throw new Error('CRON_SECRET must be different from the JWT and portal secrets.');

  const trustProxy = String(config.TRUST_PROXY ?? '').trim();
  if (trustProxy && !/^\d+$/.test(trustProxy)) throw new Error('TRUST_PROXY must be empty or the number of reverse proxies in front of the API (for example "1").');
  if (trustProxyHops(trustProxy) > 5) throw new Error('TRUST_PROXY is the number of reverse proxies in front of the API: a value above 5 is not plausible.');

  const secrets: [string, string][] = [['JWT_ACCESS_SECRET', access], ['JWT_REFRESH_SECRET', refresh], ...(portal ? [['PORTAL_TOKEN_SECRET', portal] as [string, string]] : []), ...(cron ? [['CRON_SECRET', cron] as [string, string]] : [])];
  const databaseUrl = String(config.DATABASE_URL ?? '');
  const production = String(config.NODE_ENV ?? '').trim().toLowerCase() === 'production';

  if (isRealInstallation(config)) {
    // Example, short or guessable secrets are refused: anyone who has seen the example files could forge sessions.
    const problems = secrets.map(([name, value]) => [name, secretProblem(value)] as const).filter(([, problem]) => problem).map(([name, problem]) => `${name} ${problem}`);
    if (problems.length) throw new Error(`Unsafe secret(s) for a real installation: ${problems.join('; ')}. ${GENERATE}`);
    // In production only: with a tunnel on a developer's machine the database stays local.
    if (production && databaseUrl.includes(DEV_DATABASE_PASSWORD)) throw new Error('DATABASE_URL uses the development database password, which is public. Create a database user with its own strong password for this installation.');
    const publicUrl = String(config.PUBLIC_APP_URL ?? '').trim();
    if (production && publicUrl && !/^https:\/\//i.test(publicUrl)) throw new Error('PUBLIC_APP_URL must start with https:// in production: sign-in, invitation and portal links must never travel in clear.');
    if (production && !trustProxyHops(trustProxy)) warn('TRUST_PROXY is empty in production. Behind a reverse proxy (Nginx, Caddy…) set TRUST_PROXY="1": otherwise every visitor shares the address of the proxy and the same sign-in attempt counter.');
  } else {
    for (const [name, value] of secrets) if (looksLikePlaceholder(value)) warn(`${name} is an example value. This is refused on a real installation (NODE_ENV="production" or PUBLIC_APP_URL set). ${GENERATE}`);
  }

  const apiPort = Number(config.API_PORT ?? 4000);
  if (!Number.isFinite(apiPort) || apiPort <= 0 || apiPort > 65535) {
    throw new Error('API_PORT must be a valid TCP port.');
  }

  return config;
}
