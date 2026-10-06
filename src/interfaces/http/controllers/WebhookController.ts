import type { Request, Response } from 'express';
import type { DokuWebhookVerifier } from '../../../infrastructure/payment/DokuWebhookVerifier.js';
import type { HandleDokuWebhookUseCase } from '../../../usecases/payment/HandleDokuWebhookUseCase.js';
import type { Logger } from '../../../infrastructure/logging/logger.js';
import { asyncHandler } from '../middlewares/errorHandler.js';

/**
 * Official DOKU Non-SNAP notification body (Jokul / QRIS): the merchant invoice is echoed in
 * `order.invoice_number`, the amount in `order.amount`, and the settlement state in
 * `transaction.status` (SUCCESS/FAILED). DOKU requires a non-strict parser because it may
 * add notification fields over time. The QRIS sample carries no `original_request_id`, so the
 * acquirer's `emoney_payment.approval_code` is the stable per-settlement reference.
 */
interface DokuNotifyBody {
  order?: { invoice_number?: string; amount?: string | number };
  transaction?: { status?: string; date?: string; original_request_id?: string };
  emoney_payment?: { account_id?: string; approval_code?: string };
  service?: { id?: string };
  channel?: { id?: string };
  acquirer?: { id?: string };
}

export function WebhookController(
  verifier: DokuWebhookVerifier,
  handle: HandleDokuWebhookUseCase,
  logger: Logger,
) {
  return {
    doku: asyncHandler(async (req: Request, res: Response) => {
      const raw = req.rawBody ?? Buffer.from('');
      // F4b: reject forged notifications before parsing any business field.
      const verification = verifier.verify({
        method: req.method,
        path: req.originalUrl,
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody: raw,
      });
      if (!verification.ok) {
        // SNAP header detection is an operational integration mismatch, not just a bad signature.
        logger.error({ reason: verification.reason }, 'DOKU notification signature rejected');
        res.status(401).json({ error: 'invalid_signature', errorId: verification.reason });
        return;
      }

      const body = (req.body ?? {}) as DokuNotifyBody;
      const invoiceNumber = body.order?.invoice_number ?? '';
      const amountRaw = body.order?.amount;
      const status = body.transaction?.status ?? '';
      // Use the stable acquirer reference from the notification body for event idempotency.
      // Request-Id is a delivery/request id and can change on DOKU retries.
      const providerTrxId = body.emoney_payment?.approval_code
        ?? body.transaction?.original_request_id
        ?? '';

      if (invoiceNumber === '' || amountRaw === undefined || providerTrxId === '') {
        res.status(400).json({ error: 'malformed_payload' });
        return;
      }
      let amountRupiah: bigint;
      try {
        const amountText = typeof amountRaw === 'number'
          ? (Number.isSafeInteger(amountRaw) ? String(amountRaw) : '')
          : amountRaw;
        if (!/^\d+(?:\.00)?$/.test(amountText)) throw new Error('invalid amount format');
        amountRupiah = BigInt(amountText.split('.')[0] ?? '0');
      } catch {
        res.status(400).json({ error: 'malformed_amount' });
        return;
      }

      const outcome = await handle.execute({
        providerTrxId,
        ticketId: invoiceNumber, // DOKU `order.invoice_number` echoes our ticket referenceId
        amountRupiah,
        status, // SUCCESS settles; anything else is recorded but must not mark the ticket PAID
        raw: body,
      });
      // Always 2xx so DOKU stops retrying once the event is durably recorded.
      logger.info({ outcome, trx: providerTrxId }, 'doku webhook processed');
      res.status(200).json({ outcome });
    }),
  };
}
