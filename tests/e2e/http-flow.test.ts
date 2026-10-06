import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

// End-to-end HTTP tests require a real PostGIS instance, provided by Testcontainers.
// Gated behind E2E=1 so the default `npm test` stays offline and fast.
const RUN = process.env.E2E === '1';
const skip = RUN ? describe : describe.skip;

const IN_LAT = -7.25;
const IN_LNG = 112.75;
const OUT_LAT = -6.9;
const OUT_LNG = 112.0;
const PASSWORD = 'Password#123';
const WEBHOOK_SECRET = 'e2e-webhook-secret';
const CLIENT_ID = 'e2e-client';
const PG_PATH = '/api/v1/payments/doku/webhook';

type WebhookBody = Record<string, unknown>;

/**
 * Signs a webhook using the production helper but with a fixed fresh timestamp and unique
 * request id, so the test exercises the exact official DOKU canonicalization without
 * re-implementing it (the unit test suite separately locks the format to OpenSSL vectors).
 */
async function signWebhook(
  body: WebhookBody,
): Promise<{ payload: WebhookBody; headers: Record<string, string> }> {
  const { createDokuNonSnapSignature } = await import('../../src/infrastructure/payment/DokuSignature.js');
  const rawBody = Buffer.from(JSON.stringify(body));
  const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const requestId = `req-${randomUUID()}`;
  const signature = createDokuNonSnapSignature({
    clientId: CLIENT_ID,
    requestId,
    requestTimestamp,
    requestTarget: PG_PATH,
    rawBody,
  }, WEBHOOK_SECRET);
  return {
    payload: body,
    headers: {
      'client-id': CLIENT_ID,
      'request-id': requestId,
      'request-timestamp': requestTimestamp,
      signature,
    },
  };
}

/** Official DOKU Non-SNAP notification shape: order.invoice_number + order.amount + transaction. */
function notifyBody(ticketId: string, amount: number, providerTrxId: string, status = 'SUCCESS'): WebhookBody {
  return {
    service: { id: 'QRIS' },
    acquirer: { id: 'DOKU' },
    channel: { id: 'QRIS_DOKU' },
    order: { invoice_number: ticketId, amount },
    transaction: { status, date: new Date().toISOString() },
    emoney_payment: { account_id: 'acc-1', approval_code: providerTrxId },
  };
}

skip('SuroPark end-to-end HTTP flow (Testcontainers PostGIS)', () => {
  let app: import('express').Express;
  let db: import('../../src/infrastructure/database/db.js').Db | undefined;
  const containers: { stop(): Promise<unknown> }[] = [];

  const login = async (phone: string): Promise<string> => {
    const res = await request(app).post('/api/v1/auth/login')
      .set('x-device-id', 'dev-e2e').send({ phone, password: PASSWORD });
    expect(res.status, res.text).toBe(200);
    return res.body.accessToken as string;
  };
  const auth = (t: string) => ({ Authorization: `Bearer ${t}`, 'Idempotency-Key': randomUUID(), 'x-device-id': 'dev-e2e' });
  const checkInBody = (vehiclePlate: string, lat = IN_LAT, lng = IN_LNG) =>
    ({ vehiclePlate, vehicleType: 'MOTOR', latitude: lat, longitude: lng });

  let userToken: string;
  let jukirToken: string;
  let user2Token: string;

  beforeAll(async () => {
    const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
    const { sql } = await import('kysely');
    const { Migrator } = await import('kysely/migration');
    const initial = await import('../../src/infrastructure/database/migrations/0001_initial.js');
    const { Argon2PasswordHasher } = await import('../../src/infrastructure/auth/Argon2PasswordHasher.js');

    const pg = await new PostgreSqlContainer('postgis/postgis:16-3.4')
      .withDatabase('suropark').withUsername('suropark').withPassword('e2epass')
      .start();
    containers.push(pg);
    // env.ts parses process.env at first import, so set it BEFORE importing container/app/logger.
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'fatal';
    process.env.DATABASE_URL = `postgres://suropark:e2epass@${pg.getHost()}:${pg.getMappedPort(5432)}/suropark`;
    process.env.DOKU_CLIENT_ID = CLIENT_ID;
    process.env.DOKU_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const { buildContainer } = await import('../../src/main/container.js');
    const { buildApp } = await import('../../src/main/app.js');

    const c = await buildContainer();
    app = buildApp(c);
    db = c.db;

    await new Migrator({ db: c.db, provider: { async getMigrations() { return { '0001_initial': initial }; } } }).migrateToLatest();

    const pw = await new Argon2PasswordHasher().hash(PASSWORD);
    const zoneRes = await sql<{ id: string }>`
      INSERT INTO parking_zones (code, name, boundary, base_rate_motor, base_rate_car)
      VALUES ('Z1','E2E Zone',
              ST_SetSRID(ST_MakeEnvelope(112.74, -7.27, 112.765, -7.245, 4326), 4326), 2000, 5000)
      RETURNING id`.execute(c.db);
    const zoneId = zoneRes.rows[0]?.id;
    if (!zoneId) throw new Error('seed zone failed');

    const mkUser = async (phone: string, role: string): Promise<string> => {
      const r = await sql<{ id: string }>`
        INSERT INTO users (phone_number, password_hash, role)
        VALUES (${phone}, ${pw}, ${role}) RETURNING id`.execute(c.db);
      return r.rows[0]?.id ?? (() => { throw new Error('seed user failed'); })();
    };
    const userId = await mkUser('081100000001', 'USER');
    const jukirId = await mkUser('081100000002', 'JUKIR');
    const userId2 = await mkUser('081100000003', 'USER');
    await sql`
      INSERT INTO jukir_assignments (jukir_id, zone_id, shift_start, shift_end)
      VALUES (${jukirId}::uuid, ${zoneId}::uuid, now() - interval '1 hour', now() + interval '2 hours')`.execute(c.db);

    // Mint access tokens directly for guard tests so they don't consume the login rate limit.
    userToken = await c.jwt.signAccess({ sub: userId, role: 'USER' });
    jukirToken = await c.jwt.signAccess({ sub: jukirId, role: 'JUKIR' });
    user2Token = await c.jwt.signAccess({ sub: userId2, role: 'USER' });
  }, 180_000);

  afterAll(async () => {
    await db?.destroy();
    for (const container of containers) await container.stop();
  });

  it('USER: login → check-in → check-out → signed webhook → PAID (happy path)', async () => {
    const token = await login('081100000001');

    const ci = await request(app).post('/api/v1/tickets/check-in').set(auth(token)).send(checkInBody('L1001AA'));
    expect(ci.status, ci.text).toBe(201);
    expect(ci.body.status).toBe('ISSUED');
    const ticketId = ci.body.ticketId as string;

    const co = await request(app).post('/api/v1/tickets/check-out').set(auth(token)).send({ ticketId });
    expect(co.status).toBe(200);
    expect(co.body.totalFee).toBe('2000');
    expect(co.body.qrString).toMatch(/DEVQRIS/);

    const { payload, headers } = await signWebhook(notifyBody(ticketId, 2000, 'e2e-tx-1'));
    const wh = await request(app).post(PG_PATH).set(headers).send(payload);
    expect(wh.status).toBe(200);
    expect(wh.body.outcome).toBe('processed');

    const replay = await request(app).post(PG_PATH).set(headers).send(payload);
    expect(replay.body.outcome).toBe('duplicate'); // I3: settled exactly once
  });

  it('JUKIR can check-in for its assigned, on-shift zone (ABAC)', async () => {
    const res = await request(app).post('/api/v1/tickets/check-in').set(auth(jukirToken)).send(checkInBody('L1002BB'));
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('ISSUED');
  });

  it('USER is forbidden from checking out another user’s ticket (IDOR)', async () => {
    const ci = await request(app).post('/api/v1/tickets/check-in').set(auth(userToken)).send(checkInBody('L1003CC'));
    expect(ci.status, ci.text).toBe(201);

    const co = await request(app).post('/api/v1/tickets/check-out').set(auth(user2Token)).send({ ticketId: ci.body.ticketId });
    expect(co.status).toBe(403);
  });

  it('check-in outside any zone is rejected (OUT_OF_ZONE / 422)', async () => {
    const res = await request(app).post('/api/v1/tickets/check-in').set(auth(userToken))
      .send(checkInBody('L1004DD', OUT_LAT, OUT_LNG));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('OUT_OF_ZONE');
  });

  it('FORGED webhook is rejected (401) and the ticket stays ISSUED (F4b)', async () => {
    const ci = await request(app).post('/api/v1/tickets/check-in').set(auth(userToken)).send(checkInBody('L1005EE'));
    expect(ci.status, ci.text).toBe(201);
    const ticketId = ci.body.ticketId as string;
    await request(app).post('/api/v1/tickets/check-out').set(auth(userToken)).send({ ticketId });

    const forged = await request(app).post(PG_PATH)
      .set({
        'client-id': CLIENT_ID,
        'request-id': 'forged-req',
        'request-timestamp': new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        signature: 'HMACSHA256=' + 'A'.repeat(43) + '=',
      })
      .send(notifyBody(ticketId, 2000, 'forged-1'));
    expect(forged.status).toBe(401);

    // Assert persisted DB state directly: invalid signature must not affect the ticket.
    const ticket = await db?.selectFrom('tickets').select('status').where('id', '=', ticketId).executeTakeFirst();
    expect(ticket?.status).toBe('ISSUED');

    // A correctly-signed settle for this still-ISSUED ticket succeeds → proves it was never paid.
    const { payload, headers } = await signWebhook(notifyBody(ticketId, 2000, 'forged-1-ok'));
    const good = await request(app).post(PG_PATH).set(headers).send(payload);
    expect(good.body.outcome).toBe('processed');
  });
});
