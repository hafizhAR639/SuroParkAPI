import type { Db } from '../db.js';
import type { Actor, UserRole } from '../../../domain/entities/Actor.js';
import { createHash } from 'node:crypto';

export interface UserCredential {
  readonly id: string;
  readonly role: UserRole;
  readonly passwordHash: string;
}

/** Repository for authentication + ABAC attribute loading (TRD §16.2 / §16.3). */
export class KyselyUserRepository {
  constructor(private readonly db: Db) {}

  async findCredentialByPhone(phone: string): Promise<UserCredential | null> {
    const row = await this.db
      .selectFrom('users')
      .select(['id', 'role', 'password_hash'])
      .where('phone_number', '=', phone)
      .executeTakeFirst();
    return row ? { id: row.id, role: row.role, passwordHash: row.password_hash } : null;
  }

  async findRoleById(id: string): Promise<UserRole | null> {
    const row = await this.db
      .selectFrom('users')
      .select('role')
      .where('id', '=', id)
      .executeTakeFirst();
    return row ? row.role : null;
  }

  /** Builds the ABAC Actor: role + zones with an active shift (jukir_assignments). */
  async buildActor(userId: string, role: UserRole): Promise<Actor> {
    let assignedZoneIds: string[] = [];
    let shiftActive = false;
    if (role === 'JUKIR') {
      const rows = await this.db
        .selectFrom('jukir_assignments')
        .select('zone_id')
        .where('jukir_id', '=', userId)
        .where('shift_start', '<=', new Date())
        .where('shift_end', '>=', new Date())
        .execute();
      assignedZoneIds = rows.map((r) => r.zone_id);
      shiftActive = assignedZoneIds.length > 0;
    }
    return { id: userId, role, assignedZoneIds, shiftActive };
  }
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
