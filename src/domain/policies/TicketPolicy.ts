import type { Actor } from '../entities/Actor.js';
import type { Ticket } from '../entities/Ticket.js';
import { UserRole } from '../entities/Actor.js';

/**
 * Pure authorization policy combining RBAC with attribute checks (TRD §16.3, F5).
 * USER may self-serve; JUKIR must be assigned to the zone and on an active shift.
 */
export const TicketPolicy = {
  canCheckIn(actor: Actor, ctx: { zoneId: string }): boolean {
    if (actor.role === UserRole.USER) return true;
    if (actor.role === UserRole.JUKIR) {
      return actor.assignedZoneIds.includes(ctx.zoneId) && actor.shiftActive;
    }
    return false;
  },

  canCheckOut(actor: Actor, ticket: Ticket): boolean {
    if (actor.role === UserRole.USER) return ticket.props.ownerUserId === actor.id;
    if (actor.role === UserRole.JUKIR) {
      return actor.assignedZoneIds.includes(ticket.props.zoneId);
    }
    return false;
  },
} as const;
