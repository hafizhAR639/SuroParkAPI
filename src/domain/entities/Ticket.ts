import { Money } from '../value-objects/Money.js';
import { PlateNumber } from '../value-objects/PlateNumber.js';
import { TicketStatus, assertTransition } from './TicketStatus.js';

export type VehicleType = 'MOTOR' | 'CAR' | 'TRUCK';

export interface TicketProps {
  readonly id: string;
  readonly ticketCode: string;
  readonly zoneId: string;
  readonly plate: PlateNumber;
  readonly vehicleType: VehicleType;
  readonly status: TicketStatus;
  readonly checkInAt: Date;
  readonly checkOutAt: Date | null;
  readonly totalFee: Money | null;
  /** Owner for USER self-service (TRD §16.3 / F5). */
  readonly ownerUserId: string | null;
  /** Jukir/user who issued the ticket. */
  readonly issuedByUserId: string;
}

/**
 * Parking ticket entity. Status changes must go through transition methods so the
 * state machine (ISSUED→PAID→COMPLETED / ISSUED→EXPIRED) cannot be bypassed.
 */
export class Ticket {
  constructor(readonly props: TicketProps) {}

  get status(): TicketStatus {
    return this.props.status;
  }

  markPaid(fee: Money, checkOutAt: Date): Ticket {
    assertTransition(this.props.status, TicketStatus.PAID);
    return new Ticket({
      ...this.props,
      status: TicketStatus.PAID,
      totalFee: fee,
      checkOutAt,
    });
  }

  complete(): Ticket {
    assertTransition(this.props.status, TicketStatus.COMPLETED);
    return new Ticket({ ...this.props, status: TicketStatus.COMPLETED });
  }

  expire(): Ticket {
    assertTransition(this.props.status, TicketStatus.EXPIRED);
    return new Ticket({ ...this.props, status: TicketStatus.EXPIRED });
  }

  /** A plate counts as "checked in" while a ticket is ISSUED or PAID (TRD F3). */
  isActive(): boolean {
    return this.props.status === TicketStatus.ISSUED || this.props.status === TicketStatus.PAID;
  }
}
