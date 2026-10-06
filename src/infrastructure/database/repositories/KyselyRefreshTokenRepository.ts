import type { Db } from '../db.js';
import { hashRefreshToken } from './KyselyUserRepository.js';
import { randomBytes, randomUUID } from 'node:crypto';

const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (TRD §16.2)

export interface IssuedRefresh {
  readonly token: string;
  readonly expiresAt: Date;
}

/**
 * Refresh-token store (TRD §16.2): tokens are stored as SHA-256 hashes bound to a device,
 * grouped into a rotation family. Reuse of a rotated token revokes the whole family.
 */
export class KyselyRefreshTokenRepository {
  constructor(private readonly db: Db) {}

  async issue(userId: string, deviceId: string, familyId: string): Promise<IssuedRefresh> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
    await this.db
      .insertInto('refresh_tokens')
      .values({
        id: randomUUID(),
        user_id: userId,
        family_id: familyId,
        token_hash: hashRefreshToken(token),
        device_id: deviceId,
        parent_id: null,
        expires_at: expiresAt,
        revoked: false,
      })
      .execute();
    return { token, expiresAt };
  }

  /** Returns the row for a token, or null. Caller decides on revoked/expired handling. */
  async find(token: string): Promise<{
    id: string;
    user_id: string;
    family_id: string;
    device_id: string;
    revoked: boolean;
    expires_at: Date;
  } | null> {
    const row = await this.db
      .selectFrom('refresh_tokens')
      .select(['id', 'user_id', 'family_id', 'device_id', 'revoked', 'expires_at'])
      .where('token_hash', '=', hashRefreshToken(token))
      .executeTakeFirst();
    return row ?? null;
  }

  async rotate(token: string, deviceId: string): Promise<IssuedRefresh | null> {
    const found = await this.find(token);
    if (found === null) return null;
    if (found.revoked) {
      // Reuse detection: a rotated token replayed → revoke the entire family (§16.2).
      await this.revokeFamily(found.family_id);
      return null;
    }
    if (found.expires_at.getTime() < Date.now()) return null;
    if (found.device_id !== deviceId) return null; // device binding

    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked: true })
      .where('id', '=', found.id)
      .execute();
    return this.issue(found.user_id, deviceId, found.family_id);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .updateTable('refresh_tokens')
      .set({ revoked: true })
      .where('family_id', '=', familyId)
      .execute();
  }

  async findUserId(token: string): Promise<string | null> {
    const row = await this.db
      .selectFrom('refresh_tokens')
      .select('user_id')
      .where('token_hash', '=', hashRefreshToken(token))
      .executeTakeFirst();
    return row ? row.user_id : null;
  }
}
