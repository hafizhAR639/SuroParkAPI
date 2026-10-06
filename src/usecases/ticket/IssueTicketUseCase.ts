import { DomainError } from '../../domain/errors/DomainError.js';
import { TicketPolicy } from '../../domain/policies/TicketPolicy.js';
import type { Actor } from '../../domain/entities/Actor.js';
import { PlateNumber } from '../../domain/value-objects/PlateNumber.js';
import type { Ticket, VehicleType } from '../../domain/entities/Ticket.js';
import type { TicketRepository } from '../ports/TicketRepository.js';
import { UniqueConstraintViolation } from '../ports/TicketRepository.js';
import type { LockPort } from '../ports/LockPort.js';
import type { ZoneRepository } from '../ports/ZoneRepository.js';
import type { Clock } from '../ports/Clock.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface IssueTicketInput {
  readonly actor: Actor;
  readonly vehiclePlate: string;
  readonly vehicleType: VehicleType;
  readonly latitude: number;
  readonly longitude: number;
  readonly ownerUserId: string | null;
}

const LOCK_TTL_MS = 5000;

/**
 * Issues a parking ticket with a layered concurrency guard (TRD §6.1, F2/F3).
 *  - Zone resolved authoritatively from GPS via PostGIS (anti client-spoofed zoneId).
 *  - ABAC policy decides whether the actor may check in for that zone (F5).
 *  - Redis lock (optimization) with a fencing token; the DB partial UNIQUE index is
 *    the real guarantee — a lost lock degrades to 409, never to a duplicate ticket.
 */
export class IssueTicketUseCase {
  constructor(
    private readonly tickets: TicketRepository,
    private readonly lock: LockPort,
    private readonly zones: ZoneRepository,
    private readonly clock: Clock,
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: IssueTicketInput): Promise<Ticket> {
    const plate = PlateNumber.parse(input.vehiclePlate);
    const zone = await this.zones.findZoneContaining(input.latitude, input.longitude);
    if (zone === null) {
      throw new DomainError('OUT_OF_ZONE', 'Kendaraan berada di luar zona parkir resmi.');
    }

    const zoneCtx = { zoneId: zone.id };
    if (!TicketPolicy.canCheckIn(input.actor, zoneCtx)) {
      throw new DomainError('FORBIDDEN', 'Jukir tidak bertugas atau tidak ditugaskan di zona ini.');
    }

    const lockKey = `lock:plate:${plate.value}`;
    const token = await this.lock.acquire(lockKey, LOCK_TTL_MS);
    // A missing lock is NOT fatal here (TRD §16.6, C1/C15): whether it is held by a
    // concurrent request or Redis is down, we fall through to the DB transaction where the
    // SELECT ... FOR UPDATE + partial UNIQUE index remain authoritative against duplicates.

    try {
      return await this.tickets.runInTransaction(async (tx) => {
        const active = await tx.findActiveByPlateForUpdate(plate.value);
        if (active !== null) {
          throw new DomainError('ACTIVE_TICKET_EXISTS', 'Kendaraan sudah dalam keadaan parkir aktif.');
        }
        const now = this.clock.now();
        return await tx.createTicket({
          id: this.ids.uuid(),
          ticketCode: this.ids.token(8).toUpperCase(),
          zoneId: zone.id,
          plate,
          vehicleType: input.vehicleType,
          checkInAt: now,
          ownerUserId: input.ownerUserId,
          issuedByUserId: input.actor.id,
        });
      });
    } catch (err) {
      // DB is the last line of defense: if the unique index rejected the insert
      // (Redis lost / clock skew / C15), surface it as the same business conflict.
      if (err instanceof UniqueConstraintViolation) {
        throw new DomainError('ACTIVE_TICKET_EXISTS', 'Kendaraan sudah dalam keadaan parkir aktif.');
      }
      throw err;
    } finally {
      if (token !== null) {
        await this.lock.release(lockKey, token);
      }
    }
  }
}
