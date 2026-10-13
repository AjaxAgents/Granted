/*
 * Settings come from environment variables (Azure Function App settings,
 * with secrets as Key Vault references). Nothing secret is in the repository.
 */
export interface ApiConfig {
  store: 'sql' | 'memory';
  seedDemo: boolean;
  sessionSecret: string;
  sessionDays: number;
  adminCodeHash: string;
  appUrl: string;
  allowedOrigins: string[];
  authMode: 'local' | 'external';
  exposeCodes: boolean;
  mailFrom: string;
  acsEndpoint: string;
  acsConnectionString: string;
  sqlServer: string;
  sqlDatabase: string;
  sqlConnectionString: string;
  externalId: { issuer: string; audience: string; jwksUri: string };
  production: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): ApiConfig {
  const list = (v?: string) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
  const cfg: ApiConfig = {
    store: env.GRANTED_STORE === 'memory' ? 'memory' : 'sql',
    seedDemo: env.GRANTED_SEED_DEMO === 'true',
    sessionSecret: env.SESSION_SECRET || '',
    sessionDays: Math.min(90, Math.max(1, Number(env.SESSION_DAYS) || 30)),
    adminCodeHash: (env.ADMIN_SETUP_CODE_HASH || '').trim(),
    appUrl: env.APP_URL || 'https://granted.example.com',
    allowedOrigins: list(env.ALLOWED_ORIGINS),
    authMode: env.AUTH_MODE === 'external' ? 'external' : 'local',
    exposeCodes: env.EXPOSE_CODES === 'true',
    mailFrom: env.MAIL_FROM || '',
    acsEndpoint: env.ACS_ENDPOINT || '',
    acsConnectionString: env.ACS_CONNECTION_STRING || '',
    sqlServer: env.SQL_SERVER || '',
    sqlDatabase: env.SQL_DATABASE || '',
    sqlConnectionString: env.SQL_CONNECTION_STRING || '',
    externalId: { issuer: env.EXTERNAL_ID_ISSUER || '', audience: env.EXTERNAL_ID_AUDIENCE || '', jwksUri: env.EXTERNAL_ID_JWKS_URI || '' },
    production: env.GRANTED_ENV === 'production',
  };
  const problems: string[] = [];
  if (cfg.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters.');
  if (cfg.production) {
    if (cfg.exposeCodes) problems.push('EXPOSE_CODES must be false in production.');
    if (cfg.store !== 'sql') problems.push('GRANTED_STORE must be sql in production.');
    if (cfg.seedDemo) problems.push('GRANTED_SEED_DEMO must be false in production.');
    if (!cfg.mailFrom || !(cfg.acsEndpoint || cfg.acsConnectionString)) problems.push('MAIL_FROM and ACS_ENDPOINT are required in production.');
    if (/^[0-9a-f]{64}$/i.test(cfg.adminCodeHash)) problems.push('ADMIN_SETUP_CODE_HASH must use the pbkdf2$ format in production (tools/admin-code-hash.mjs).');
    if (cfg.allowedOrigins.some((o) => o.startsWith('http://') && !o.startsWith('http://localhost'))) problems.push('ALLOWED_ORIGINS must use https.');
  }
  if (cfg.authMode === 'external' && (!cfg.externalId.issuer || !cfg.externalId.audience || !cfg.externalId.jwksUri)) problems.push('EXTERNAL_ID_ISSUER, EXTERNAL_ID_AUDIENCE and EXTERNAL_ID_JWKS_URI are required when AUTH_MODE=external.');
  if (problems.length) throw new Error('Granted API configuration: ' + problems.join(' '));
  return cfg;
}
