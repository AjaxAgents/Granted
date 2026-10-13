/*
 * Sessions.
 *   local:    the API issues a signed session token (HS256, SESSION_SECRET from Key Vault)
 *             carrying the user ID and session version. A password change bumps the
 *             version, which ends every other session at once.
 *   external: the app signs in with Microsoft Entra External ID and sends its access token;
 *             the API checks the signature against the tenant's published keys, the issuer
 *             and the audience, then maps the token's object ID to a Granted user.
 */
import { SignJWT, createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { ApiConfig } from './config';

const ISSUER = 'granted-api';
const AUDIENCE = 'granted-app';

export class Tokens {
  private key: Uint8Array;
  private jwks?: ReturnType<typeof createRemoteJWKSet>;
  constructor(private cfg: ApiConfig) {
    this.key = new TextEncoder().encode(cfg.sessionSecret);
    if (cfg.authMode === 'external') this.jwks = createRemoteJWKSet(new URL(cfg.externalId.jwksUri));
  }

  async issue(userId: string, sessionVersion: number): Promise<string> {
    return new SignJWT({ sv: sessionVersion })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId).setIssuer(ISSUER).setAudience(AUDIENCE)
      .setIssuedAt().setExpirationTime(this.cfg.sessionDays + 'd')
      .sign(this.key);
  }

  /** A Granted session token: { userId, sessionVersion }, or null if invalid or expired. */
  async verifyLocal(token: string): Promise<{ userId: string; sessionVersion: number } | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, { issuer: ISSUER, audience: AUDIENCE, algorithms: ['HS256'] });
      if (!payload.sub || typeof payload.sv !== 'number') return null;
      return { userId: payload.sub, sessionVersion: payload.sv };
    } catch { return null; }
  }

  /** An Entra External ID access token: { externalId, email }, or null. */
  async verifyExternal(token: string): Promise<{ externalId: string; email: string } | null> {
    if (!this.jwks) return null;
    try {
      const { payload } = await jwtVerify(token, this.jwks, { issuer: this.cfg.externalId.issuer, audience: this.cfg.externalId.audience });
      const p = payload as JWTPayload & { oid?: string; email?: string; emails?: string[]; preferred_username?: string };
      const externalId = p.oid || p.sub;
      const email = p.email || (Array.isArray(p.emails) ? p.emails[0] : '') || p.preferred_username || '';
      return externalId ? { externalId, email } : null;
    } catch { return null; }
  }
}
