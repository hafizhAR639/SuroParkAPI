import type { PaymentRepository, WebhookPayload } from '../ports/PaymentRepository.js';

export type WebhookOutcome =
  | 'processed'
  | 'duplicate'
  | 'ticket_not_found'
  | 'amount_mismatch'
  | 'not_payable_state'
  | 'not_successful';

/**
 * Safe & idempotent DOKU webhook processing (TRD §16.7, F4). Signature verification is done
 * in the interfaces layer before this runs. Everything happens in ONE transaction:
 *  - dedup on provider_trx_id (a duplicate/replayed event has no second effect — I3);
 *  - amount validated against the server-side total_fee, never the payload (F4b);
 *  - state-machine guard so an ISSUED ticket becomes PAID exactly once.
 */
export class HandleDokuWebhookUseCase {
  constructor(private readonly payments: PaymentRepository) {}

  async execute(payload: WebhookPayload): Promise<WebhookOutcome> {
    return this.payments.runWebhookTransaction(async (tx) => {
      const inserted = await tx.insertPaymentEventIfAbsent(payload.providerTrxId, payload.raw);
      if (!inserted) {
        return 'duplicate';
      }

      const ticket = await tx.findTicketForUpdate(payload.ticketId);
      if (ticket === null) {
        return 'ticket_not_found';
      }

      // A FAILED/expired notification is durably recorded above but must never settle a ticket.
      if (payload.status !== 'SUCCESS') {
        return 'not_successful';
      }

      if (ticket.totalFee === null || ticket.totalFee.rupiah !== payload.amountRupiah) {
        await tx.flagMismatch(payload.ticketId, payload.providerTrxId);
        return 'amount_mismatch';
      }

      if (ticket.status !== 'ISSUED') {
        return 'not_payable_state';
      }

      await tx.markPaid(payload.ticketId);
      return 'processed';
    });
  }
}
