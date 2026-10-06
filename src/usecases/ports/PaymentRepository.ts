import type { Money } from '../../domain/value-objects/Money.js';
import type { TicketStatus } from '../../domain/entities/TicketStatus.js';

export interface WebhookPayload {
  readonly providerTrxId: string;
  readonly ticketId: string;
  readonly amountRupiah: bigint;
  readonly status: string;
  readonly raw: unknown;
}

export interface WebhookTx {
  /** Insert the raw event; returns false when the provider_trx_id already exists (dedup). */
  insertPaymentEventIfAbsent(providerTrxId: string, raw: unknown): Promise<boolean>;
  findTicketForUpdate(id: string): Promise<{ status: TicketStatus; totalFee: Money | null } | null>;
  markPaid(id: string): Promise<void>;
  /** Record a server-vs-payload amount divergence for later investigation. */
  flagMismatch(ticketId: string, providerTrxId: string): Promise<void>;
}

export interface PaymentRepository {
  runWebhookTransaction<T>(fn: (tx: WebhookTx) => Promise<T>): Promise<T>;
}
