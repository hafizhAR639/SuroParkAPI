import { randomUUID } from 'node:crypto';
import type { PaymentGateway, QrisRequest, QrisResult } from '../../usecases/ports/PaymentGateway.js';

/** Deterministic offline QRIS for local dev/tests when DOKU credentials are absent (TRD §9). */
export class StubPaymentGateway implements PaymentGateway {
  async createQris(req: QrisRequest): Promise<QrisResult> {
    return {
      qrString: `DEVQRIS|${req.ticketId}|${req.amountRupiah.toString()}`,
      providerTrxId: `stub-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 120_000),
    };
  }
}
