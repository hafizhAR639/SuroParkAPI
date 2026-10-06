import { DomainError } from '../../domain/errors/DomainError.js';
import { TicketPolicy } from '../../domain/policies/TicketPolicy.js';
import type { Actor } from '../../domain/entities/Actor.js';
import type { Ticket } from '../../domain/entities/Ticket.js';
import { computeTariff } from '../../domain/services/DynamicTariff.js';
import type { TicketRepository } from '../ports/TicketRepository.js';
import type { LockPort } from '../ports/LockPort.js';
import type { ZoneRepository } from '../ports/ZoneRepository.js';
import type { PaymentGateway } from '../ports/PaymentGateway.js';
import type { Clock } from '../ports/Clock.js';
import type { QrisResult } from '../ports/PaymentGateway.js';

export interface CheckoutInput {
  readonly actor: Actor;
  readonly ticketId: string;
}

export interface CheckoutResult {
  readonly ticket: Ticket;
  readonly qris: QrisResult;
}

const CHECKOUT_LOCK_TTL_MS = 10000;

/**
 * Computes the authoritative fee server-side (TRD §9, F4b: amount is never taken from
 * a client payload) and generates a QRIS. A per-ticket lock avoids duplicate QRIS
 * sessions (§7.2); the persisted fee is what the webhook later reconciles against.
 */
export class CheckoutTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly lock: LockPort,
    private readonly zones: ZoneRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
  ) {}

  async execute(input: CheckoutInput): Promise<CheckoutResult> {
    const lockKey = `lock:checkout:${input.ticketId}`;
    const token = await this.lock.acquire(lockKey, CHECKOUT_LOCK_TTL_MS);
    if (token === null) {
      throw new DomainError('CONCURRENT_CONFLICT', 'Ada proses check-out bersamaan untuk tiket ini.');
    }

    try {
      const { ticket, feeNumeric } = await this.tickets.runInTransaction(async (tx) => {
        const t = await tx.findByIdForUpdate(input.ticketId);
        if (t === null) {
          throw new DomainError('TICKET_NOT_FOUND', 'Tiket tidak ditemukan.');
        }
        if (!TicketPolicy.canCheckOut(input.actor, t)) {
          throw new DomainError('FORBIDDEN', 'Anda tidak berwenang menutup tiket ini.');
        }
        if (!t.isActive()) {
          throw new DomainError('INVALID_TRANSITION', 'Tiket sudah dibayar atau tidak aktif.');
        }
        const zone = await this.zones.findById(t.props.zoneId);
        if (zone === null) {
          throw new DomainError('OUT_OF_ZONE', 'Zona tiket tidak valid.');
        }
        const checkOutAt = this.clock.now();
        const fee = computeTariff(
          { baseRateMotor: zone.baseRateMotor, baseRateCar: zone.baseRateCar },
          t.props.vehicleType,
          t.props.checkInAt,
          checkOutAt,
        );
        const saved = await tx.saveCheckout({ id: t.props.id, totalFee: fee, checkOutAt });
        return { ticket: saved, feeNumeric: fee.rupiah };
      });

      // Network call happens OUTSIDE the DB transaction. referenceId = ticket id gives
      // idempotency so a retried check-out reuses the same QRIS rather than billing twice.
      const qris = await this.gateway.createQris({
        referenceId: ticket.props.id,
        amountRupiah: feeNumeric,
        ticketId: ticket.props.id,
      });
      return { ticket, qris };
    } finally {
      await this.lock.release(lockKey, token);
    }
  }
}
