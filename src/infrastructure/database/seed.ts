import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb } from './db.js';
import { logger } from '../logging/logger.js';

const db = createDb();

/** Argon2id with TRD §16.2 minimums: memory ≥ 64 MiB, iterations ≥ 3, parallelism 1. */
async function hashPassword(plain: string): Promise<string> {
  return hash(plain, {
    algorithm: 2, // argon2id
    memoryCost: 64 * 1024, // KiB → 64 MiB
    timeCost: 3,
    parallelism: 1,
  });
}

/**
 * Local development seed. Demo credentials below are intentionally well-known and MUST NOT
 * reach production: the guard aborts when NODE_ENV=production.
 *
 * Seeded logins (password for all demo accounts: `Password#123`):
 *   USER   081100000001   self-service check-in / check-out / report
 *   USER   081100000003   second user, used to demonstrate IDOR denial
 *   JUKIR  081100000002   assigned to ZON-GBT-01 with an active shift (ABAC happy path)
 *   ADMIN  081230000001   admin map endpoint (password: ChangeMe#2026)
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo credentials when NODE_ENV=production.');
  }

  // 1) Demo parking zone covering the Gelora Bung Tomo area.
  const zoneResult = await sql<{ id: string }>`
    INSERT INTO parking_zones (code, name, boundary, base_rate_motor, base_rate_car)
    VALUES (
      'ZON-GBT-01', 'Gelora Bung Tomo Zona A',
      ST_SetSRID(ST_MakeEnvelope(112.740, -7.270, 112.765, -7.245, 4326), 4326),
      2000, 5000
    )
    ON CONFLICT (code) DO UPDATE SET is_active = TRUE
    RETURNING id`.execute(db);
  const zoneId = zoneResult.rows[0]?.id;
  if (!zoneId) throw new Error('failed to seed demo parking zone');

  const userPasswordHash = await hashPassword('Password#123');
  const adminPasswordHash = await hashPassword('ChangeMe#2026');

  const upsertUser = async (phone: string, passwordHash: string, role: string): Promise<string> => {
    const result = await sql<{ id: string }>`
      INSERT INTO users (id, phone_number, password_hash, role)
      VALUES (${randomUUID()}, ${phone}, ${passwordHash}, ${role})
      ON CONFLICT (phone_number) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            role = EXCLUDED.role
      RETURNING id`.execute(db);
    const id = result.rows[0]?.id;
    if (!id) throw new Error(`failed to seed user ${phone}`);
    return id;
  };

  const userId = await upsertUser('081100000001', userPasswordHash, 'USER');
  const jukirId = await upsertUser('081100000002', userPasswordHash, 'JUKIR');
  const secondUserId = await upsertUser('081100000003', userPasswordHash, 'USER');
  const adminId = await upsertUser('081230000001', adminPasswordHash, 'ADMIN');

  // 2) Keep the JUKIR assigned to the demo zone with a rolling active shift, so ABAC checks pass
  //    for local testing without hand-editing timestamps.
  await sql`DELETE FROM jukir_assignments WHERE jukir_id = ${jukirId}::uuid`.execute(db);
  await sql`
    INSERT INTO jukir_assignments (jukir_id, zone_id, shift_start, shift_end)
    VALUES (${jukirId}::uuid, ${zoneId}::uuid, now() - interval '1 hour', now() + interval '30 days')`
    .execute(db);

  logger.info('seed complete (development credentials — do not use in production)');
  logger.info({
    zoneId,
    zoneCode: 'ZON-GBT-01',
    users: {
      USER: { phone: '081100000001', password: 'Password#123', id: userId },
      JUKIR: { phone: '081100000002', password: 'Password#123', id: jukirId },
      USER_SECOND: { phone: '081100000003', password: 'Password#123', id: secondUserId },
      ADMIN: { phone: '081230000001', password: 'ChangeMe#2026', id: adminId },
    },
  }, 'demo login accounts');
}

await main();
await db.destroy();
