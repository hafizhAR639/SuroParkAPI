import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export const DOKU_NON_SNAP_SIGNATURE_PREFIX = 'HMACSHA256=';

export interface DokuNonSnapSignatureInput {
  readonly clientId: string;
  readonly requestId: string;
  readonly requestTimestamp: string;
  readonly requestTarget: string;
  readonly rawBody: Buffer;
}

/** DOKU non-SNAP digest: Base64(SHA-256(exact UTF-8 request/notification body bytes)). */
export function dokuNonSnapDigest(rawBody: Buffer): string {
  return createHash('sha256').update(rawBody).digest('base64');
}

/**
 * DOKU Non-SNAP/Jokul canonical string from the official Signature Component docs:
 * Client-Id, Request-Id, Request-Timestamp, Request-Target, Digest, newline-separated,
 * with no trailing newline. HMAC-SHA256 result is Base64 and prefixed `HMACSHA256=`.
 */
export function dokuNonSnapCanonical(input: DokuNonSnapSignatureInput): string {
  return [
    `Client-Id:${input.clientId}`,
    `Request-Id:${input.requestId}`,
    `Request-Timestamp:${input.requestTimestamp}`,
    `Request-Target:${input.requestTarget}`,
    `Digest:${dokuNonSnapDigest(input.rawBody)}`,
  ].join('\n');
}

export function createDokuNonSnapSignature(input: DokuNonSnapSignatureInput, secret: string): string {
  const mac = createHmac('sha256', secret).update(dokuNonSnapCanonical(input), 'utf8').digest('base64');
  return `${DOKU_NON_SNAP_SIGNATURE_PREFIX}${mac}`;
}

export function verifyDokuNonSnapSignature(
  input: DokuNonSnapSignatureInput,
  secret: string,
  signature: string,
): boolean {
  if (!signature.startsWith(DOKU_NON_SNAP_SIGNATURE_PREFIX)) return false;
  const encoded = signature.slice(DOKU_NON_SNAP_SIGNATURE_PREFIX.length);
  if (!/^[A-Za-z0-9+/]{43}=$/.test(encoded)) return false;
  const expected = Buffer.from(createDokuNonSnapSignature(input, secret).slice(DOKU_NON_SNAP_SIGNATURE_PREFIX.length), 'base64');
  const actual = Buffer.from(encoded, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface DokuSnapSignatureInput {
  readonly method: string;
  readonly endpointPath: string;
  readonly accessToken: string;
  readonly timestamp: string;
  /** Exact compact JSON bytes sent in the request body. */
  readonly rawBody: Buffer;
}

/**
 * DOKU SNAP symmetric signature, per the QRIS API docs:
 * METHOD:EndpointUrl:AccessToken:lowercase(hex(SHA256(minified JSON body))):Timestamp
 * HMAC-SHA512(clientSecret, stringToSign), Base64 encoded (X-SIGNATURE).
 */
export function dokuSnapStringToSign(input: DokuSnapSignatureInput): string {
  const bodyHashHex = createHash('sha256').update(input.rawBody).digest('hex').toLowerCase();
  return `${input.method.toUpperCase()}:${input.endpointPath}:${input.accessToken}:${bodyHashHex}:${input.timestamp}`;
}

export function createDokuSnapSignature(input: DokuSnapSignatureInput, clientSecret: string): string {
  return createHmac('sha512', clientSecret).update(dokuSnapStringToSign(input), 'utf8').digest('base64');
}

/** Test/helper for verification where the partner API specifies the matching SNAP format. */
export function verifyDokuSnapSignature(
  input: DokuSnapSignatureInput,
  clientSecret: string,
  signature: string,
): boolean {
  if (!/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  const expected = Buffer.from(createDokuSnapSignature(input, clientSecret), 'base64');
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
