import { describe, it, expect } from 'vitest';
import { HandleDokuWebhookUseCase } from '../../src/usecases/payment/HandleDokuWebhookUseCase.js';
import type { PaymentRepository, WebhookTx, WebhookPayload } from '../../src/usecases/ports/PaymentRepository.js';
import { Money } from '../../src/domain/value-objects/Money.js';

interface State { ticketStatus: 'ISSUED' | 'PAID'; totalFee: bigint | null; paidCount: number; mismatch: boolean; events: Set<string> }

function makeRepo(state: State): PaymentRepository {
  const tx = (): WebhookTx => ({
    async insertPaymentEventIfAbsent(id): Promise<boolean> {
      if (state.events.has(id)) return false;
      state.events.add(id);
      return true;
    },
    async findTicketForUpdate() {
      return { status: state.ticketStatus, totalFee: state.totalFee !== null ? Money.fromRupiah(state.totalFee) : null };
    },
    async markPaid() {
      state.paidCount += 1;
      state.ticketStatus = 'PAID';
    },
    async flagMismatch() {
      state.mismatch = true;
    },
  });
  return { async runWebhookTransaction(fn) { return fn(tx()); } };
}

const payload = (amount: bigint, trx = 'trx-1', status = 'SUCCESS'): WebhookPayload => ({
  providerTrxId: trx, ticketId: 't1', amountRupiah: amount, status, raw: {},
});

describe('DOKU webhook (TRD §16.7, F4)', () => {
  it('settles an ISSUED ticket exactly once', async () => {
    const state: State = { ticketStatus: 'ISSUED', totalFee: 3000n, paidCount: 0, mismatch: false, events: new Set() };
    const uc = new HandleDokuWebhookUseCase(makeRepo(state));
    expect(await uc.execute(payload(3000n))).toBe('processed');
    expect(state.ticketStatus).toBe('PAID');
    expect(state.paidCount).toBe(1);
  });

  it('replayed event has no second effect (I3, no double-credit)', async () => {
    const state: State = { ticketStatus: 'ISSUED', totalFee: 3000n, paidCount: 0, mismatch: false, events: new Set() };
    const uc = new HandleDokuWebhookUseCase(makeRepo(state));
    expect(await uc.execute(payload(3000n))).toBe('processed');
    for (let i = 0; i < 5; i++) expect(await uc.execute(payload(3000n))).toBe('duplicate');
    expect(state.paidCount).toBe(1); // exactly once
  });

  it('flags an amount mismatch instead of trusting the payload (F4b)', async () => {
    const state: State = { ticketStatus: 'ISSUED', totalFee: 3000n, paidCount: 0, mismatch: false, events: new Set() };
    const uc = new HandleDokuWebhookUseCase(makeRepo(state));
    expect(await uc.execute(payload(1n))).toBe('amount_mismatch'); // forged low amount
    expect(state.mismatch).toBe(true);
    expect(state.ticketStatus).toBe('ISSUED'); // not paid
  });

  it('does not settle an ISSUED ticket on a failed payment notification', async () => {
    const state: State = { ticketStatus: 'ISSUED', totalFee: 3000n, paidCount: 0, mismatch: false, events: new Set() };
    const uc = new HandleDokuWebhookUseCase(makeRepo(state));
    expect(await uc.execute(payload(3000n, 'trx-failed', 'FAILED'))).toBe('not_successful');
    expect(state.ticketStatus).toBe('ISSUED');
    expect(state.paidCount).toBe(0);
  });

  it('does not re-pay an already PAID ticket (state machine guard)', async () => {
    const state: State = { ticketStatus: 'PAID', totalFee: 3000n, paidCount: 0, mismatch: false, events: new Set() };
    const uc = new HandleDokuWebhookUseCase(makeRepo(state));
    expect(await uc.execute(payload(3000n, 'trx-new'))).toBe('not_payable_state');
    expect(state.paidCount).toBe(0);
  });
});
