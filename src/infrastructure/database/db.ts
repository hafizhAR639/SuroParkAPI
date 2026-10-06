import { Kysely, PostgresDialect, type Generated } from 'kysely';
import { Pool } from 'pg';
import { env } from '../config/env.js';

/** Column-level types for Kysely. Geometry/stored money are handled as strings at this boundary. */
export interface Database {
  users: {
    id: string;
    phone_number: string;
    phone_hash: string | null;
    password_hash: string;
    role: 'ADMIN' | 'JUKIR' | 'USER' | 'INSPECTOR';
    created_at: Generated<Date>;
  };
  parking_zones: {
    id: string;
    code: string;
    name: string;
    /** PostGIS geometry; never bound by Kysely builder (raw SQL only). */
    boundary: unknown;
    base_rate_motor: string;
    base_rate_car: string;
    is_active: boolean;
  };
  tickets: {
    id: string;
    ticket_code: string;
    zone_id: string;
    vehicle_plate: string;
    vehicle_type: 'MOTOR' | 'CAR' | 'TRUCK';
    check_in_at: Date;
    check_out_at: Date | null;
    total_fee: string | null;
    status: 'ISSUED' | 'PAID' | 'COMPLETED' | 'EXPIRED';
    qr_hash: string | null;
    owner_user_id: string | null;
    issued_by_user_id: string;
  };
  jukir_assignments: {
    id: string;
    jukir_id: string;
    zone_id: string;
    shift_start: Date;
    shift_end: Date;
  };
  refresh_tokens: {
    id: string;
    user_id: string;
    family_id: string;
    token_hash: string;
    device_id: string;
    parent_id: string | null;
    expires_at: Date;
    revoked: boolean;
    created_at: Generated<Date>;
  };
  payment_events: {
    id: Generated<bigint>;
    provider_trx_id: string;
    raw: unknown;
    received_at: Generated<Date>;
  };
  audit_logs: {
    id: Generated<bigint>;
    actor_id: string | null;
    actor_role: string | null;
    action: string;
    entity: string | null;
    entity_id: string | null;
    before: unknown;
    after: unknown;
    ip: string | null;
    device_id: string | null;
    prev_hash: Uint8Array | null;
    row_hash: Uint8Array | null;
    created_at: Generated<Date>;
  };
}

export type Db = Kysely<Database>;

export function createDb(databaseUrl: string = env.DATABASE_URL ?? ''): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString: databaseUrl,
        max: 10,
        statement_timeout: 2000, // TRD §17.4: explicit DB timeout, no unbounded queues.
        connectionTimeoutMillis: 2000,
      }),
    }),
  });
}
