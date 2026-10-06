import type {
  TicketRepository, TicketTx, CreateTicketInput, CheckoutTicketInput,
} from '../../src/usecases/ports/TicketRepository.js';
import { UniqueConstraintViolation } from '../../src/usecases/ports/TicketRepository.js';
import type { LockPort } from '../../src/usecases/ports/LockPort.js';
import type { ZoneRepository, ZoneRecord } from '../../src/usecases/ports/ZoneRepository.js';
import type { Clock } from '../../src/usecases/ports/Clock.js';
import type { IdGenerator } from '../../src/usecases/ports/IdGenerator.js';
import type { Ticket } from '../../src/domain/entities/Ticket.js';
import { Ticket as TicketEntity } from '../../src/domain/entities/Ticket.js';
import { Money } from '../../src/domain/value-objects/Money.js';

export const ZONE: ZoneRecord = {
  id: 'z1', code: 'ZON-TEST-01', name: 'Test Zone', baseRateMotor: 2000n, baseRateCar: 5000n,
};

/**
 * In-memory repository that mirrors the production guarantee: the partial UNIQUE index
 * uq_tickets_one_active_per_plate. createTicket throws UniqueConstraintViolation when an
 * ISSUED/PAID ticket already exists for the plate — regardless of interleaving — just like Postgres.
 */
export class InMemoryTicketRepository implements TicketRepository {
  private store = new Map<string, Ticket>();
  private activeByPlate = new Map<string, string>();

  async runInTransaction<T>(fn: (tx: TicketTx) => Promise<T>): Promise<T> {
    // The only write on the check-in path is createTicket, which throws UniqueConstraintViolation
    // BEFORE mutating shared state when the plate is already active — so a failing transaction
    // leaves no trace (matching Postgres). No coarse global rollback needed, and none is correct
    // under concurrency (row-level MVCC, not snapshot restore).
    return fn(this.tx());
  }

  activeCountForPlate(plate: string): number {
    const id = this.activeByPlate.get(plate);
    return id ? 1 : 0;
  }

  private tx(): TicketTx {
    const repo = this;
    return {
      async findActiveByPlateForUpdate(plateValue) {
        const id = repo.activeByPlate.get(plateValue);
        return id ? (repo.store.get(id) ?? null) : null;
      },
      async findByIdForUpdate(id) {
        return repo.store.get(id) ?? null;
      },
      async createTicket(input: CreateTicketInput): Promise<Ticket> {
        const plate = input.plate.value;
        // Emulate the partial unique index — atomic against any interleaving.
        if (repo.activeByPlate.has(plate)) {
          throw new UniqueConstraintViolation();
        }
        const ticket = new TicketEntity({
          id: input.id, ticketCode: input.ticketCode, zoneId: input.zoneId, plate: input.plate,
          vehicleType: input.vehicleType, status: 'ISSUED', checkInAt: input.checkInAt,
          checkOutAt: null, totalFee: null, ownerUserId: input.ownerUserId,
          issuedByUserId: input.issuedByUserId,
        });
        repo.store.set(ticket.props.id, ticket);
        repo.activeByPlate.set(plate, ticket.props.id);
        return ticket;
      },
      async saveCheckout(input: CheckoutTicketInput): Promise<Ticket> {
        const cur = repo.store.get(input.id);
        if (!cur) throw new Error('not found');
        const updated = new TicketEntity({ ...cur.props, totalFee: input.totalFee, checkOutAt: input.checkOutAt });
        repo.store.set(input.id, updated);
        return updated;
      },
      async markPaid(id): Promise<Ticket> {
        const cur = repo.store.get(id);
        if (!cur) throw new Error('not found');
        const updated = cur.markPaid(cur.props.totalFee ?? Money.fromRupiah(0n), cur.props.checkOutAt ?? new Date());
        repo.store.set(id, updated);
        // PAID still counts as active (partial unique index covers ISSUED+PAID) — keep the entry.
        return updated;
      },
    };
  }
}

/** Lock that either always grants (Redis healthy) or always denies (Redis down — chaos C1). */
export function makeLock(available: boolean, grantsAll: boolean = true): LockPort {
  return {
    async acquire(): Promise<string | null> {
      return available ? (grantsAll ? 'token' : null) : null;
    },
    async release(): Promise<void> {},
  };
}

export const fakeClock = (fixed: Date = new Date('2026-01-01T00:00:00Z')): Clock => ({
  now: () => fixed,
});

export const fakeIds = (): IdGenerator => {
  let n = 0;
  return { uuid: () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, token: () => 'ab12cd34' };
};

export const zoneRepoWith = (zone: ZoneRecord | null): ZoneRepository => ({
  async findZoneContaining() { return zone; },
  async findById(id) { return zone && zone.id === id ? zone : null; },
  async listActiveGeoJson() { return []; },
});
