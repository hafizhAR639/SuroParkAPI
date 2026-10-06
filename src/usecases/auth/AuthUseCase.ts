import { randomUUID } from 'node:crypto';
import type {
  PasswordHasher,
  RefreshTokenStore,
  TokenIssuer,
  UserStore,
} from '../ports/Auth.js';

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
}

/**
 * Authentication use case (TRD §16.2). Login failures are uniform and constant-timing to
 * prevent phone enumeration; refresh does rotation + reuse detection. Concrete brute-force
 * limiting is the login rate limiter, not this logic. Depends only on ports (no infra imports).
 */
export class AuthUseCase {
  constructor(
    private readonly users: UserStore,
    private readonly refreshTokens: RefreshTokenStore,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenIssuer,
  ) {}

  async login(phone: string, password: string, deviceId: string): Promise<TokenPair | null> {
    const cred = await this.users.findCredentialByPhone(phone);
    if (cred === null) {
      // Constant work even when the phone is unknown (anti-enumeration).
      await this.hasher.verify(DUMMY_HASH, password);
      return null;
    }
    if (!(await this.hasher.verify(cred.passwordHash, password))) return null;

    const accessToken = await this.tokens.signAccess({ sub: cred.id, role: cred.role });
    const { token: refreshToken } = await this.refreshTokens.issue(cred.id, deviceId, randomUUID());
    return { accessToken, refreshToken };
  }

  async refresh(refreshToken: string, deviceId: string): Promise<TokenPair | null> {
    const rotated = await this.refreshTokens.rotate(refreshToken, deviceId);
    if (rotated === null) return null;
    const userId = await this.refreshTokens.findUserId(rotated.token);
    if (userId === null) return null;
    const role = await this.users.findRoleById(userId);
    if (role === null) return null;
    const accessToken = await this.tokens.signAccess({ sub: userId, role });
    return { accessToken, refreshToken: rotated.token };
  }
}

/** A structurally valid Argon2id digest used only to normalize timing on unknown phone. */
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=1$0000000000000000$000000000000000000000000000';
