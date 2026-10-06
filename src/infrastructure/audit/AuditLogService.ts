import { createHash } from 'node:crypto';
import type { Db } from '../database/db.js';

export interface AuditEntry {
  readonly actorId?: string | undefined;
  readonly actorRole?: string | undefined;
  readonly action: string;
  readonly entity?: string | undefined;
  readonly entityId?: string | undefined;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ip?: string | undefined;
  readonly deviceId?: string | undefined;
}

/**
 * Append-only audit trail with a hash chain (TRD §16.8): each row's hash covers the previous
 * row's hash, so tampering or deletion is detectable. DB-level `REVOKE UPDATE/DELETE` (applied
 * in migration/ops) plus daily export to WORM storage back this up.
 */
export class AuditLogService {
  constructor(private readonly db: Db) {}

  async log(entry: AuditEntry): Promise<void> {
    const last = await this.db
      .selectFrom('audit_logs')
      .select('row_hash')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst();
    const prev = last?.row_hash ?? null;

    const payload = JSON.stringify({
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entity: entry.entity ?? null,
      entityId: entry.entityId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
    });
    const hasher = createHash('sha256').update(payload);
    if (prev) hasher.update(Buffer.from(prev));
    const rowHash = hasher.digest();
    const prevBytes = prev ? Buffer.from(prev) : null;

    await this.db
      .insertInto('audit_logs')
      .values({
        actor_id: entry.actorId ?? null,
        actor_role: entry.actorRole ?? null,
        action: entry.action,
        entity: entry.entity ?? null,
        entity_id: entry.entityId ?? null,
        before: entry.before ?? null,
        after: entry.after ?? null,
        ip: entry.ip ?? null,
        device_id: entry.deviceId ?? null,
        prev_hash: prevBytes ? new Uint8Array(prevBytes) : null,
        row_hash: new Uint8Array(rowHash),
      })
      .execute();
  }
}
