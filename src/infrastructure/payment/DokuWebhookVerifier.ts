import { verifyDokuNonSnapSignature } from './DokuSignature.js';

export interface RawWebhookRequest {
  readonly method: string;
  /** Exact merchant notification URL path, including a possible query string. */
  readonly path: string;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly rawBody: Buffer;
}

export interface DokuWebhookVerifierOptions {
  /** DOKU Non-SNAP/Jokul Secret Key used to sign HTTP notification messages. */
  readonly secret: string;
  readonly expectedClientId: string;
  readonly now?: () => number;
}

/**
 * Failure reasons are returned (not just `false`) so operators can distinguish a genuine
 * forgery from a product/scheme misconfiguration. In particular `snap_headers_detected`
 * means DOKU delivered a SNAP-style notification while this verifier expects the Non-SNAP
 * contract — a configuration mismatch that must be resolved with DOKU support, never
 * papered over by weakening verification.
 */
export type DokuWebhookVerifyFailure =
  | 'missing_headers'
  | 'snap_headers_detected'
  | 'unknown_client'
  | 'timestamp_out_of_window'
  | 'bad_signature';

export type DokuWebhookVerifyResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: DokuWebhookVerifyFailure };

const OK: DokuWebhookVerifyResult = { ok: true };

/** Max accepted clock skew, applied symmetrically to past and future timestamps. */
export const DOKU_WEBHOOK_SKEW_MS = 5 * 60 * 1000;

function header(req: RawWebhookRequest, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Verifies DOKU's documented HTTP notification signature:
 * Client-Id, Request-Id, Request-Timestamp, Signature; Digest = Base64(SHA-256(raw body));
 * HMAC-SHA256 over the newline-separated component block, prefixed `HMACSHA256=`.
 *
 * Timestamp freshness is enforced symmetrically (|now - ts| <= 5 min) so a forged or
 * clock-skewed future timestamp is rejected exactly like a stale one.
 *
 * Outbound SNAP QRIS request signatures use a separate HMAC-SHA512 scheme (DokuSignature.ts).
 * Whether a given merchant account receives Non-SNAP or SNAP notifications is configured on
 * the DOKU side; this verifier implements the Non-SNAP contract and reports SNAP headers
 * explicitly instead of failing indistinguishably.
 */
export class DokuWebhookVerifier {
  constructor(private readonly options: DokuWebhookVerifierOptions) {}

  verify(req: RawWebhookRequest): DokuWebhookVerifyResult {
    const clientId = header(req, 'client-id');
    const requestId = header(req, 'request-id');
    const requestTimestamp = header(req, 'request-timestamp');
    const signature = header(req, 'signature');

    // Detect the SNAP notification shape before reporting a generic failure, so a scheme
    // mismatch is visible in logs rather than looking like an attack or a broken secret.
    if (clientId === undefined && header(req, 'x-partner-id') !== undefined) {
      return { ok: false, reason: 'snap_headers_detected' };
    }
    if (!clientId || !requestId || !requestTimestamp || !signature) {
      return { ok: false, reason: 'missing_headers' };
    }
    if (clientId !== this.options.expectedClientId || requestId.length > 128) {
      return { ok: false, reason: 'unknown_client' };
    }

    const timestampMs = Date.parse(requestTimestamp);
    if (!Number.isFinite(timestampMs)
      || Math.abs((this.options.now ?? Date.now)() - timestampMs) > DOKU_WEBHOOK_SKEW_MS) {
      return { ok: false, reason: 'timestamp_out_of_window' };
    }

    // DOKU Request-Target is the merchant notification URL path; omit query parameters.
    const queryIndex = req.path.indexOf('?');
    const requestTarget = queryIndex === -1 ? req.path : req.path.slice(0, queryIndex);

    const valid = verifyDokuNonSnapSignature({
      clientId,
      requestId,
      requestTimestamp,
      requestTarget,
      rawBody: req.rawBody,
    }, this.options.secret, signature);

    return valid ? OK : { ok: false, reason: 'bad_signature' };
  }
}
