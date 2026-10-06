import { type Transaction } from 'kysely';
import type { Database, Db } from '../db.js';
import {
  UniqueConstraintViolation,
  type CreateTicketInput,
  type CheckoutTicketInput,
  type TicketRepository,
  type TicketTx,
} from '../../../usecases/ports/TicketRepository.js';
import { Ticket, type VehicleType } from '../../../domain/entities/Ticket.js';
import type { TicketStatus } from '../../../domain/entities/TicketStatus.js';
import { Money } from '../../../domain/value-objects/Money.js';
import { PlateNumber } from '../../../domain/value-objects/PlateNumber.js';

interface TicketRow {
  id: string;
  ticket_code: string;
  zone_id: string;
  vehicle_plate: string;
  vehicle_type: VehicleType;
  check_in_at: Date;
  check_out_at: Date | null;
  total_fee: string | null;
  status: TicketStatus;
  qr_hash: string | null;
  owner_user_id: string | null;
  issued_by_user_id: string;
}

function toDomain(row: TicketRow): Ticket {
  return new Ticket({
    id: row.id,
    ticketCode: row.ticket_code,
    zoneId: row.zone_id,
    plate: PlateNumber.parse(row.vehicle_plate),
    vehicleType: row.vehicle_type,
    status: row.status,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    totalFee: row.total_fee !== null ? Money.fromNumericString(row.total_fee) : null,
    ownerUserId: row.owner_user_id,
    issuedByUserId: row.issued_by_user_id,
  });
}

class KyselyTicketTx implements TicketTx {
  constructor(private readonly trx: Transaction<Database>) {}

  async findActiveByPlateForUpdate(plateValue: string): Promise<Ticket | null> {
    const row = await this.trx
      .selectFrom('tickets')
      .selectAll()
      .where('vehicle_plate', '=', plateValue)
      .where('status', 'in', ['ISSUED', 'PAID'])
      .forUpdate()
      .executeTakeFirst();
    return row ? toDomain(row as TicketRow) : null;
  }

  async findByIdForUpdate(id: string): Promise<Ticket | null> {
    const row = await this.trx
      .selectFrom('tickets')
      .selectAll()
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirst();
    return row ? toDomain(row as TicketRow) : null;
  }

  async createTicket(input: CreateTicketInput): Promise<Ticket> {
    try {
      const row = await this.trx
        .insertInto('tickets')
        .values({
          id: input.id,
          ticket_code: input.ticketCode,
          zone_id: input.zoneId,
          vehicle_plate: input.plate.value,
          vehicle_type: input.vehicleType,
          check_in_at: input.checkInAt,
          status: 'ISSUED',
          qr_hash: null,
          owner_user_id: input.ownerUserId,
          issued_by_user_id: input.issuedByUserId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toDomain(row as unknown as TicketRow);
    } catch (err) {
      if (isUniqueViolation(err, 'uq_tickets_one_active_per_plate')) {
        throw new UniqueConstraintViolation();
      }
      throw err;
    }
  }

  async saveCheckout(input: CheckoutTicketInput): Promise<Ticket> {
    const row = await this.trx
      .updateTable('tickets')
      .set({ total_fee: input.totalFee.toNumericString(), check_out_at: input.checkOutAt })
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toDomain(row as unknown as TicketRow);
  }

  async markPaid(id: string): Promise<Ticket> {
    const row = await this.trx
      .updateTable('tickets')
      .set({ status: 'PAID' })
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirstOrThrow();
    return toDomain(row as unknown as TicketRow);
  }
}

export class KyselyTicketRepository implements TicketRepository {
  constructor(private readonly db: Db) {}

  runInTransaction<T>(fn: (tx: TicketTx) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => fn(new KyselyTicketTx(trx)));
  }
}

/** Narrow Postgres unique-violation detection (SQLSTATE 23505), optionally by constraint. */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  if (e?.code !== '23505') return false;
  return constraint === undefined ? true : e.constraint === constraint;
}
