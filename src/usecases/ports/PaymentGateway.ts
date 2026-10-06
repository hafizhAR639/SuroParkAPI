export interface QrisRequest {
  /** Stable idempotency key so a retried checkout never creates a second QRIS (F4). */
  readonly referenceId: string;
  readonly amountRupiah: bigint;
  readonly ticketId: string;
}

export interface QrisResult {
  readonly qrString: string;
  readonly providerTrxId: string;
  readonly expiresAt: Date;
}

/** Payment gateway port (TRD §9). Implemented by the DOKU adapter (circuit-broken). */
export interface PaymentGateway {
  createQris(req: QrisRequest): Promise<QrisResult>;
}
