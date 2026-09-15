const REQUIRED = ['DATABASE_URL', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

export function validateEnvironment(config: Record<string, unknown>) {
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

  const apiPort = Number(config.API_PORT ?? 4000);
  if (!Number.isFinite(apiPort) || apiPort <= 0 || apiPort > 65535) {
    throw new Error('API_PORT must be a valid TCP port.');
  }

  return config;
}
