import type { PlateNumber } from '../../domain/value-objects/PlateNumber.js';
import type { Money } from '../../domain/value-objects/Money.js';
import type { Ticket, VehicleType } from '../../domain/entities/Ticket.js';

export interface CreateTicketInput {
  readonly id: string;
  readonly ticketCode: string;
  readonly zoneId: string;
  readonly plate: PlateNumber;
  readonly vehicleType: VehicleType;
  readonly checkInAt: Date;
  readonly ownerUserId: string | null;
  readonly issuedByUserId: string;
}

export interface CheckoutTicketInput {
  readonly id: string;
  readonly totalFee: Money;
  readonly checkOutAt: Date;
}

/**
 * Repository port owned by the use case layer (TRD §18.2). All check-in / check-out
 * reads+writes run inside a single DB transaction so the pessimistic row lock and the
 * partial UNIQUE index (F3) cooperate atomically.
 */
export interface TicketTx {
  /** SELECT ... FOR UPDATE the active (ISSUED/PAID) ticket for a plate, else null. */
  findActiveByPlateForUpdate(plateValue: string): Promise<Ticket | null>;
  findByIdForUpdate(id: string): Promise<Ticket | null>;
  /** Insert a ticket. Throws UniqueConstraintViolation if the partial unique index is hit. */
  createTicket(input: CreateTicketInput): Promise<Ticket>;
  /** Persist the computed fee + checkout time while ticket stays ISSUED until paid. */
  saveCheckout(input: CheckoutTicketInput): Promise<Ticket>;
  markPaid(id: string): Promise<Ticket>;
}

export interface TicketRepository {
  runInTransaction<T>(fn: (tx: TicketTx) => Promise<T>): Promise<T>;
}

/**
 * Signal thrown by the repository when Postgres rejects a write with 23505.
 * The use case maps this to ACTIVE_TICKET_EXISTS — this is the DB-level guard that
 * holds even when the Redis lock is lost (TRD F2/F3/C1/C15).
 */
export class UniqueConstraintViolation extends Error {
  constructor(message = 'unique constraint violation') {
    super(message);
    this.name = 'UniqueConstraintViolation';
  }
}
