/** Port owned by the use case layer (TRD §18.2). */
export interface IdGenerator {
  uuid(): string;
  /** Opaque, unguessable token (e.g. ticket code, QR nonce). */
  token(bytes?: number): string;
}
