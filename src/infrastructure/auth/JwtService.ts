import { SignJWT, jwtVerify, importPKCS8, type KeyLike } from 'jose';
import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { logger } from '../logging/logger.js';
import type { Env } from '../config/env.js';

export interface AccessClaims {
  readonly sub: string;
  readonly role: 'ADMIN' | 'JUKIR' | 'USER' | 'INSPECTOR';
  readonly typ: 'access';
}

const ACCESS_TTL = '15m'; // TRD §16.2

/** EdDSA (Ed25519) access tokens with iss/aud/exp validation (TRD §16.2). alg:none is rejected. */
export class JwtService {
  private constructor(
    private readonly privateKey: KeyLike,
    private readonly publicKey: KeyLike,
    private readonly issuer: string,
    private readonly audience: string,
    private readonly keyId: string,
  ) {}

  static async create(env: Env): Promise<JwtService> {
    let privateKey: KeyLike;
    let publicKey: KeyLike;
    if (env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY) {
      privateKey = (await importPKCS8(env.JWT_PRIVATE_KEY, 'EdDSA')) as KeyLike;
      publicKey = createPublicKey(JSON.parse(env.JWT_PUBLIC_KEY)) as unknown as KeyLike;
    } else if (env.NODE_ENV === 'production') {
      throw new Error('JWT_PRIVATE_KEY/JWT_PUBLIC_KEY are required in production (TRD §16.2).');
    } else {
      logger.warn('Using an EPHEMERAL Ed25519 JWT key — DEV ONLY, tokens invalid on restart.');
      const { privateKey: priv, publicKey: pub } = generateKeyPairSync('ed25519');
      privateKey = priv as unknown as KeyLike;
      publicKey = pub as unknown as KeyLike;
    }
    return new JwtService(privateKey, publicKey, env.JWT_ISSUER, env.JWT_AUDIENCE, env.JWT_KEY_ID);
  }

  async signAccess(claims: { readonly sub: string; readonly role: AccessClaims['role'] }): Promise<string> {
    return new SignJWT({ role: claims.role, typ: 'access' })
      .setProtectedHeader({ alg: 'EdDSA', kid: this.keyId })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer(this.issuer)
      .setAudience(this.audience)
      .setExpirationTime(ACCESS_TTL)
      .sign(this.privateKey);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.publicKey, {
        issuer: this.issuer,
        audience: this.audience,
        algorithms: ['EdDSA'],
      });
      if (payload.typ !== 'access' || typeof payload.sub !== 'string') return null;
      return { sub: payload.sub, role: payload.role as AccessClaims['role'], typ: 'access' };
    } catch {
      return null;
    }
  }
}
