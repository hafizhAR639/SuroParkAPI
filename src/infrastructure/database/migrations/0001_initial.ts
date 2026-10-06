import type { Kysely } from 'kysely';
import { sql } from 'kysely';

/**
 * Initial schema (TRD §4) with the security & correctness fixes:
 *  - F3: partial UNIQUE index enforces one active ticket per plate at the DB level.
 *  - F5: jukir_assignments + tickets.owner_user_id/issued_by_user_id for ABAC + IDOR.
 *  - F10/F4: payments via payment_events (transactional idempotency) + append-only audit_logs.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE EXTENSION IF NOT EXISTS postgis`.execute(db);
  await sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`.execute(db);

  await sql`
    CREATE TABLE users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number  VARCHAR(20) NOT NULL UNIQUE,
      phone_hash    TEXT,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('ADMIN','JUKIR','USER','INSPECTOR')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.execute(db);

  await sql`
    CREATE TABLE parking_zones (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      code            VARCHAR(10) NOT NULL UNIQUE,
      name            VARCHAR(100) NOT NULL,
      boundary        GEOMETRY(Polygon, 4326) NOT NULL,
      base_rate_motor NUMERIC(10,2) NOT NULL,
      base_rate_car   NUMERIC(10,2) NOT NULL,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE
    )`.execute(db);

  await sql`
    CREATE TABLE tickets (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ticket_code      VARCHAR(32) NOT NULL UNIQUE,
      zone_id          UUID NOT NULL REFERENCES parking_zones(id),
      vehicle_plate    VARCHAR(15) NOT NULL,
      vehicle_type     TEXT NOT NULL CHECK (vehicle_type IN ('MOTOR','CAR','TRUCK')),
      check_in_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
      check_out_at     TIMESTAMPTZ,
      total_fee        NUMERIC(10,2),
      status           TEXT NOT NULL DEFAULT 'ISSUED'
                         CHECK (status IN ('ISSUED','PAID','COMPLETED','EXPIRED')),
      qr_hash          TEXT UNIQUE,
      owner_user_id    UUID REFERENCES users(id),
      issued_by_user_id UUID NOT NULL REFERENCES users(id)
    )`.execute(db);

  // F3 — the real guarantee against duplicate active tickets (replaces idx_tickets_active_lookup).
  await sql`
    CREATE UNIQUE INDEX uq_tickets_one_active_per_plate
      ON tickets (vehicle_plate)
      WHERE status IN ('ISSUED','PAID')`.execute(db);

  await sql`
    CREATE INDEX idx_tickets_zone_status ON tickets (zone_id, status)`.execute(db);

  await sql`
    CREATE TABLE jukir_assignments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      jukir_id    UUID NOT NULL REFERENCES users(id),
      zone_id     UUID NOT NULL REFERENCES parking_zones(id),
      shift_start TIMESTAMPTZ NOT NULL,
      shift_end   TIMESTAMPTZ NOT NULL
    )`.execute(db);
  await sql`
    CREATE INDEX idx_jukir_assignments_active
      ON jukir_assignments (jukir_id, zone_id)`.execute(db);

  await sql`
    CREATE TABLE refresh_tokens (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id    UUID NOT NULL REFERENCES users(id),
      family_id  UUID NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      device_id  TEXT NOT NULL,
      parent_id  UUID,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked    BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`
    CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id)`.execute(db);

  // F4 — transactional webhook idempotency. One row per provider transaction id.
  await sql`
    CREATE TABLE payment_events (
      id              BIGSERIAL PRIMARY KEY,
      provider_trx_id TEXT UNIQUE NOT NULL,
      raw             JSONB NOT NULL,
      received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.execute(db);

  // F10/§16.8 — append-only, hash-chained audit trail.
  await sql`
    CREATE TABLE audit_logs (
      id         BIGSERIAL PRIMARY KEY,
      actor_id   UUID,
      actor_role TEXT,
      action     TEXT NOT NULL,
      entity     TEXT,
      entity_id  TEXT,
      before     JSONB,
      after      JSONB,
      ip         INET,
      device_id  TEXT,
      prev_hash  BYTEA,
      row_hash   BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.execute(db);

  // Spatial indexes (TRD §4.2).
  await sql`
    CREATE INDEX idx_parking_zones_boundary
      ON parking_zones USING GIST (boundary)`.execute(db);
  await sql`
    CREATE TABLE violation_reports (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reporter_user_id UUID NOT NULL REFERENCES users(id),
      location         GEOMETRY(Point, 4326) NOT NULL,
      photo_url        TEXT,
      description      TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'PENDING'
                         CHECK (status IN ('PENDING','VERIFIED','DISMISSED')),
      created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
    )`.execute(db);
  await sql`
    CREATE INDEX idx_violation_reports_location
      ON violation_reports USING GIST (location)`.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DROP TABLE IF EXISTS violation_reports, audit_logs, payment_events,
      refresh_tokens, jukir_assignments, tickets, parking_zones, users CASCADE`.execute(db);
}
