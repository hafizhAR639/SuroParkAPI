import { describe, it, expect } from 'vitest';
import {
  createDokuNonSnapSignature,
  dokuNonSnapCanonical,
  dokuNonSnapDigest,
  createDokuSnapSignature,
  dokuSnapStringToSign,
} from '../../src/infrastructure/payment/DokuSignature.js';
import { DokuWebhookVerifier, DOKU_WEBHOOK_SKEW_MS } from '../../src/infrastructure/payment/DokuWebhookVerifier.js';

const SECRET = 'secret-key-from-doku-back-office';
const SNAP_SECRET = 'snap-client-secret';
const CLIENT_ID = 'MCH-0001-10791114622547';
const REQUEST_ID = 'fdb69f47-96da-499d-acec-7cdc318ab2fe';
const TIMESTAMP = '2026-09-28T07:54:49Z';
const PATH = '/api/v1/payments/doku/webhook';
const BODY = Buffer.from(
  '{"service":{"id":"QRIS"},"order":{"invoice_number":"11111111-1111-4111-8111-111111111111","amount":2000.00},"transaction":{"status":"SUCCESS"}}',
);
const NOW = Date.parse(TIMESTAMP);
const webhookVerifier = new DokuWebhookVerifier({
  secret: SECRET,
  expectedClientId: CLIENT_ID,
  now: () => NOW,
});

function makeHeaders(signature: string, timestamp = TIMESTAMP, clientId = CLIENT_ID) {
  return {
    'client-id': clientId,
    'request-id': REQUEST_ID,
    'request-timestamp': timestamp,
    signature,
  };
}

describe('DOKU official Non-SNAP/Jokul signature format', () => {
  const input = {
    clientId: CLIENT_ID,
    requestId: REQUEST_ID,
    requestTimestamp: TIMESTAMP,
    requestTarget: PATH,
    rawBody: BODY,
  };

  it('uses the official Base64 SHA-256 digest of exact raw body bytes', () => {
    expect(dokuNonSnapDigest(Buffer.from(''))).toBe('47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=');
    expect(dokuNonSnapDigest(Buffer.from('abc'))).toBe('ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=');
    expect(dokuNonSnapDigest(BODY)).toBe('TpE3HlrSZ+aLdRFkZiaB5nqQEJ8Y1/Ul2drrzSgr5+g=');
  });

  it('formats exact canonical components with newlines and no trailing newline', () => {
    expect(dokuNonSnapCanonical(input)).toBe([
      `Client-Id:${CLIENT_ID}`,
      `Request-Id:${REQUEST_ID}`,
      `Request-Timestamp:${TIMESTAMP}`,
      `Request-Target:${PATH}`,
      'Digest:TpE3HlrSZ+aLdRFkZiaB5nqQEJ8Y1/Ul2drrzSgr5+g=',
    ].join('\n'));
  });

  it('matches a frozen HMAC-SHA256 Base64 vector computed independently with OpenSSL', () => {
    expect(createDokuNonSnapSignature(input, SECRET)).toBe(
      'HMACSHA256=CFtMHaJ0kuaYXS8e/7oKDm2AftWdpv4cJRVtrZXhBTs=',
    );
  });

  it('verifies standard DOKU notification headers and timestamp format', () => {
    const signature = createDokuNonSnapSignature(input, SECRET);
    expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: BODY, headers: makeHeaders(signature) })).toEqual({ ok: true });
  });

  it('rejects forged signatures, wrong client IDs, stale timestamps, and changed body bytes', () => {
    const signature = createDokuNonSnapSignature(input, SECRET);
    expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: BODY, headers: makeHeaders('HMACSHA256=' + 'A'.repeat(44)) }))
      .toEqual({ ok: false, reason: 'bad_signature' });
    expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: BODY, headers: makeHeaders(signature, TIMESTAMP, 'other-client') }))
      .toEqual({ ok: false, reason: 'unknown_client' });
    const stale = '2026-09-28T07:40:00Z';
    expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: BODY, headers: makeHeaders(signature, stale) }))
      .toEqual({ ok: false, reason: 'timestamp_out_of_window' });
    expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: Buffer.from(BODY.toString().replace('2000.00', '1.00')), headers: makeHeaders(signature) }))
      .toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('enforces the timestamp window symmetrically: future timestamps are rejected too', () => {
    const signature = createDokuNonSnapSignature(input, SECRET);
    const futureBeyondWindow = new Date(NOW + DOKU_WEBHOOK_SKEW_MS + 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: BODY, headers: makeHeaders(signature, futureBeyondWindow) }))
      .toEqual({ ok: false, reason: 'timestamp_out_of_window' });
  });

  it('accepts exactly at the skew boundary on both sides and rejects just past it', () => {
    const at = (offsetMs: number) => new Date(NOW + offsetMs).toISOString().replace(/\.\d{3}Z$/, 'Z');

    for (const offset of [DOKU_WEBHOOK_SKEW_MS, -DOKU_WEBHOOK_SKEW_MS]) {
      const timestamp = at(offset);
      const signature = createDokuNonSnapSignature({ ...input, requestTimestamp: timestamp }, SECRET);
      expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: BODY, headers: makeHeaders(signature, timestamp) }))
        .toEqual({ ok: true });
    }
    for (const offset of [DOKU_WEBHOOK_SKEW_MS + 1_000, -(DOKU_WEBHOOK_SKEW_MS + 1_000)]) {
      const timestamp = at(offset);
      const signature = createDokuNonSnapSignature({ ...input, requestTimestamp: timestamp }, SECRET);
      expect(webhookVerifier.verify({ method: 'POST', path: PATH, rawBody: BODY, headers: makeHeaders(signature, timestamp) }))
        .toEqual({ ok: false, reason: 'timestamp_out_of_window' });
    }
  });

  it('reports SNAP-style notification headers distinctly from a bad signature', () => {
    const result = webhookVerifier.verify({
      method: 'POST',
      path: PATH,
      rawBody: BODY,
      headers: {
        'x-partner-id': CLIENT_ID,
        'x-external-id': '1234567890',
        'x-timestamp': TIMESTAMP,
        'x-signature': 'anything',
        authorization: 'Bearer token',
      },
    });
    expect(result).toEqual({ ok: false, reason: 'snap_headers_detected' });
  });
});

describe('DOKU SNAP QRIS request signature format', () => {
  const body = Buffer.from(
    '{"partnerReferenceNo":"ticket-123","amount":{"value":"3000.00","currency":"IDR"},"merchantId":"MID-1","terminalId":"T01","validityPeriod":"2026-09-28T08:00:00Z","additionalInfo":{"postalCode":"60111","feeType":"1"}}',
  );
  const input = {
    method: 'POST',
    endpointPath: '/snap-adapter/b2b/v1.0/qr/qr-mpm-generate',
    accessToken: 'access-token-fixture',
    timestamp: TIMESTAMP,
    rawBody: body,
  };

  it('signs method:path:token:lowercase SHA-256 hex of compact body:timestamp using HMAC-SHA512', () => {
    expect(dokuSnapStringToSign(input)).toBe(
      'POST:/snap-adapter/b2b/v1.0/qr/qr-mpm-generate:access-token-fixture:8c9efb4f08552326b1dedea735afe9e89f3714ae7889121a8a57dd5fa3001f91:2026-09-28T07:54:49Z',
    );
    expect(createDokuSnapSignature(input, SNAP_SECRET)).toBe(
      'oM4YGUxpNfDQ6RwfsN4XzsszeijoV3B0v3xNVQVSAz3/IJR35juesyraeeJ5wIqMMUvBlyEhUk0J+LoswVRtjw==',
    );
  });
});
