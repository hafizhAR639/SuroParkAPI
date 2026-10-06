import type { Transaction } from 'kysely';
import type { Database, Db } from '../db.js';
import {
  type PaymentRepository,
  type WebhookTx,
} from '../../../usecases/ports/PaymentRepository.js';
import type { TicketStatus } from '../../../domain/entities/TicketStatus.js';
import { Money } from '../../../domain/value-objects/Money.js';

class KyselyPaymentTx implements WebhookTx {
  constructor(private readonly trx: Transaction<Database>) {}

  async insertPaymentEventIfAbsent(providerTrxId: string, raw: unknown): Promise<boolean> {
    const res = await this.trx
      .insertInto('payment_events')
      .values({ provider_trx_id: providerTrxId, raw: raw as object })
      .onConflict((oc) => oc.column('provider_trx_id').doNothing())
      .returning('id')
      .executeTakeFirst();
    // ON CONFLICT DO NOTHING returns no row for a duplicate provider event.
    return res !== undefined;
  }

  async findTicketForUpdate(
    id: string,
  ): Promise<{ status: TicketStatus; totalFee: Money | null } | null> {
    const row = await this.trx
      .selectFrom('tickets')
      .select(['status', 'total_fee'])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    if (!row) return null;
    return {
      status: row.status,
      totalFee: row.total_fee !== null ? Money.fromNumericString(row.total_fee) : null,
    };
  }

  async markPaid(id: string): Promise<void> {
    await this.trx
      .updateTable('tickets')
      .set({ status: 'PAID' })
      .where('id', '=', id)
      .execute();
  }

  async flagMismatch(ticketId: string, providerTrxId: string): Promise<void> {
    await this.trx
      .insertInto('audit_logs')
      .values({
        action: 'PAYMENT_AMOUNT_MISMATCH',
        entity: 'TICKET',
        entity_id: ticketId,
        after: { provider_trx_id: providerTrxId },
      })
      .execute();
  }
}

export class KyselyPaymentRepository implements PaymentRepository {
  constructor(private readonly db: Db) {}

  runWebhookTransaction<T>(fn: (tx: WebhookTx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => fn(new KyselyPaymentTx(trx)));
  }
}
