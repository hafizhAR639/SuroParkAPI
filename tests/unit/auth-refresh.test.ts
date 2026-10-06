import { describe, it, expect } from 'vitest';
import { AuthUseCase } from '../../src/usecases/auth/AuthUseCase.js';
import type {
  PasswordHasher, RefreshTokenStore, TokenIssuer, UserStore, UserCredential,
} from '../../src/usecases/ports/Auth.js';
import type { UserRole } from '../../src/domain/entities/Actor.js';

/** In-memory refresh store mirroring family rotation + reuse detection (TRD §16.2). */
class FakeRefreshStore implements RefreshTokenStore {
  private rows = new Map<string, { userId: string; family: string; revoked: boolean }>();
  private seq = 0;
  async issue(userId: string, _dev: string, family: string) {
    const token = `tok-${++this.seq}`;
    this.rows.set(token, { userId, family, revoked: false });
    return { token };
  }
  async rotate(token: string) {
    const row = this.rows.get(token);
    if (!row) return null;
    if (row.revoked) {
      for (const r of this.rows.values()) if (r.family === row.family) r.revoked = true; // reuse ⇒ kill family
      return null;
    }
    row.revoked = true;
    return this.issue(row.userId, 'dev', row.family);
  }
  async findUserId(token: string) { return this.rows.get(token)?.userId ?? null; }
}

const hasher: PasswordHasher = { async hash(p) { return `h:${p}`; }, async verify(enc, p) { return enc === `h:${p}`; } };
const tokens: TokenIssuer = { async signAccess() { return 'jwt'; } };
const store: UserStore = {
  async findCredentialByPhone(phone: string): Promise<UserCredential | null> {
    return phone === '0811' ? { id: 'u1', role: 'USER' as UserRole, passwordHash: 'h:pw' } : null;
  },
  async findRoleById(id: string) { return id === 'u1' ? ('USER' as UserRole) : null; },
};

describe('Auth refresh rotation + reuse detection (TRD §16.2)', () => {
  it('login issues an access+refresh pair; bad password rejected', async () => {
    const auth = new AuthUseCase(store, new FakeRefreshStore(), hasher, tokens);
    expect(await auth.login('0811', 'pw', 'dev1')).not.toBeNull();
    expect(await auth.login('0811', 'wrong', 'dev1')).toBeNull();
  });

  it('reusing an old rotated token revokes the whole family (stolen token → sessions killed)', async () => {
    const store2 = new FakeRefreshStore();
    const auth = new AuthUseCase(store, store2, hasher, tokens);
    const pair = (await auth.login('0811', 'pw', 'dev1'))!;
    const afterFirst = (await auth.refresh(pair.refreshToken, 'dev1'))!; // rotate → new token
    // Attacker replays the ORIGINAL token after it was rotated:
    const reuse = await auth.refresh(pair.refreshToken, 'dev1');
    expect(reuse).toBeNull();
    // And the legitimate new token is now dead too (family revoked).
    expect(await auth.refresh(afterFirst.refreshToken, 'dev1')).toBeNull();
  });
});
