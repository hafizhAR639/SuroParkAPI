import type { PaymentGateway, QrisRequest, QrisResult } from '../../usecases/ports/PaymentGateway.js';
import CircuitBreaker from 'opossum';
import { randomUUID } from 'node:crypto';
import { createDokuSnapSignature } from './DokuSignature.js';
import type { Env } from '../config/env.js';

const GENERATE_QRIS_PATH = '/snap-adapter/b2b/v1.0/qr/qr-mpm-generate';

interface SnapAccessTokenResponse {
  accessToken: string;
  expiresIn: number;
}

interface GenerateQrisResponse {
  responseCode?: string;
  responseMessage?: string;
  referenceNo?: string;
  partnerReferenceNo?: string;
  qrContent?: string;
  additionalInfo?: { validityPeriod?: string };
}

/**
 * DOKU SNAP Dynamic QRIS adapter. Implements documented B2B token + QRIS generate flow:
 *  - POST /authorization/v1/access-token/b2b
 *  - POST /snap-adapter/b2b/v1.0/qr/qr-mpm-generate
 *
 * SNAP's HMAC-SHA512 `X-SIGNATURE` is distinct from the Non-SNAP notification HMAC-SHA256
 * and follows the official formula in DokuSignature.ts. Calls are circuit-broken and timed out.
 */
export class DokuPaymentGateway implements PaymentGateway {
  private readonly breaker: CircuitBreaker<[QrisRequest], QrisResult>;
  private tokenCache: { token: string; expiresAt: number } | undefined;

  constructor(private readonly env: Env) {
    this.breaker = new CircuitBreaker<[QrisRequest], QrisResult>(
      (req) => this.callDoku(req),
      { timeout: 5000, errorThresholdPercentage: 50, resetTimeout: 15000, rollingCountTimeout: 10000 },
    );
  }

  createQris(req: QrisRequest): Promise<QrisResult> {
    return this.breaker.fire(req);
  }

  private async callDoku(req: QrisRequest): Promise<QrisResult> {
    const clientId = this.env.DOKU_CLIENT_ID;
    const clientSecret = this.env.DOKU_CLIENT_SECRET;
    const merchantId = this.env.DOKU_MERCHANT_ID;
    const terminalId = this.env.DOKU_TERMINAL_ID;
    if (!clientId || !clientSecret || !merchantId || !terminalId) {
      throw new Error('DOKU SNAP requires DOKU_CLIENT_ID, DOKU_CLIENT_SECRET, DOKU_MERCHANT_ID, DOKU_TERMINAL_ID.');
    }

    const accessToken = await this.getAccessToken(clientId);
    const requestTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    // X-EXTERNAL-ID must be a unique numeric string per day (DOKU QRIS SNAP spec).
    const externalId = `${Date.now()}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
    const body = {
      partnerReferenceNo: req.referenceId,
      amount: { value: `${req.amountRupiah.toString()}.00`, currency: 'IDR' },
      merchantId,
      terminalId,
      validityPeriod: new Date(Date.now() + 120_000).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      additionalInfo: { postalCode: this.env.DOKU_POSTAL_CODE, feeType: '1' },
    };
    const rawBody = Buffer.from(JSON.stringify(body));
    const signature = createDokuSnapSignature({
      method: 'POST',
      endpointPath: GENERATE_QRIS_PATH,
      accessToken,
      timestamp: requestTimestamp,
      rawBody,
    }, clientSecret);

    const response = await fetch(new URL(GENERATE_QRIS_PATH, this.env.DOKU_BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-PARTNER-ID': clientId,
        'X-EXTERNAL-ID': externalId,
        'X-TIMESTAMP': requestTimestamp,
        'X-SIGNATURE': signature,
        Authorization: `Bearer ${accessToken}`,
        'CHANNEL-ID': 'H2H',
      },
      body: rawBody,
      signal: AbortSignal.timeout(5000),
    });
    const result = await response.json() as GenerateQrisResponse;
    if (!response.ok || !result.qrContent) {
      throw new Error(`DOKU QRIS generate failed: HTTP ${response.status} ${result.responseCode ?? ''} ${result.responseMessage ?? ''}`);
    }
    return {
      qrString: result.qrContent,
      providerTrxId: result.referenceNo ?? req.referenceId,
      expiresAt: body.validityPeriod ? new Date(body.validityPeriod) : new Date(Date.now() + 120_000),
    };
  }

  private async getAccessToken(clientId: string): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now() + 30_000) return this.tokenCache.token;

    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    const body = Buffer.from(JSON.stringify({ grantType: 'client_credentials' }));
    const requestId = randomUUID();
    const tokenPath = '/authorization/v1/access-token/b2b';
    // SNAP B2B token signature is asymmetric SHA256withRSA with merchant private key.
    // DOKU_CLIENT_SECRET here is not the RSA signing key: do not fake this operation.
    const privateKeyPem = this.env.DOKU_PRIVATE_KEY;
    if (!privateKeyPem) {
      throw new Error('DOKU SNAP B2B token requires DOKU_PRIVATE_KEY (RSA merchant private key).');
    }
    const { createSign } = await import('node:crypto');
    const signer = createSign('RSA-SHA256');
    signer.update(`${clientId}|${timestamp}`);
    const tokenSignature = signer.sign(privateKeyPem, 'base64');
    const response = await fetch(new URL(tokenPath, this.env.DOKU_BASE_URL), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-SIGNATURE': tokenSignature,
        'X-TIMESTAMP': timestamp,
        'X-CLIENT-KEY': clientId,
        'X-REQUEST-ID': requestId,
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
    const payload = await response.json() as SnapAccessTokenResponse & { responseMessage?: string };
    if (!response.ok || !payload.accessToken || !payload.expiresIn) {
      throw new Error(`DOKU B2B token failed: HTTP ${response.status} ${payload.responseMessage ?? ''}`);
    }
    this.tokenCache = { token: payload.accessToken, expiresAt: Date.now() + payload.expiresIn * 1000 };
    return payload.accessToken;
  }
}
