import { DomainError } from '../errors/DomainError.js';

export const TicketStatus = {
  ISSUED: 'ISSUED',
  PAID: 'PAID',
  COMPLETED: 'COMPLETED',
  EXPIRED: 'EXPIRED',
} as const;
export type TicketStatus = (typeof TicketStatus)[keyof typeof TicketStatus];

/** Allowed transitions: ISSUED→PAID→COMPLETED, ISSUED→EXPIRED (TRD §18.5). */
const TRANSITIONS: Readonly<Record<TicketStatus, readonly TicketStatus[]>> = {
  ISSUED: [TicketStatus.PAID, TicketStatus.EXPIRED],
  PAID: [TicketStatus.COMPLETED],
  COMPLETED: [],
  EXPIRED: [],
};

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (!TRANSITIONS[from].includes(to)) {
    throw new DomainError(
      'INVALID_TRANSITION',
      `Transisi tiket tidak valid: ${from} → ${to}`,
    );
  }
}
