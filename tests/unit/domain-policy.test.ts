import { describe, it, expect } from 'vitest';
import { TicketPolicy } from '../../src/domain/policies/TicketPolicy.js';
import type { Actor } from '../../src/domain/entities/Actor.js';
import { computeTariff } from '../../src/domain/services/DynamicTariff.js';
import { Ticket } from '../../src/domain/entities/Ticket.js';
import { PlateNumber } from '../../src/domain/value-objects/PlateNumber.js';
import { Money } from '../../src/domain/value-objects/Money.js';

const jukir: Actor = { id: 'j1', role: 'JUKIR', assignedZoneIds: ['z1'], shiftActive: true };
const jukirOffShift: Actor = { ...jukir, shiftActive: false };
const jukirWrongZone: Actor = { ...jukir, assignedZoneIds: ['z9'] };
const user: Actor = { id: 'u1', role: 'USER', assignedZoneIds: [], shiftActive: false };

describe('TicketPolicy ABAC (TRD §16.3, F5)', () => {
  it('USER may self check-in', () => {
    expect(TicketPolicy.canCheckIn(user, { zoneId: 'z1' })).toBe(true);
  });
  it('JUKIR only in assigned zone on active shift', () => {
    expect(TicketPolicy.canCheckIn(jukir, { zoneId: 'z1' })).toBe(true);
    expect(TicketPolicy.canCheckIn(jukirOffShift, { zoneId: 'z1' })).toBe(false);
    expect(TicketPolicy.canCheckIn(jukirWrongZone, { zoneId: 'z1' })).toBe(false);
  });

  const ticketOf = (owner: string, zone: string): Ticket =>
    new Ticket({
      id: 't1', ticketCode: 'CODE', zoneId: zone, plate: PlateNumber.parse('L1SB'),
      vehicleType: 'MOTOR', status: 'ISSUED', checkInAt: new Date(), checkOutAt: null,
      totalFee: null, ownerUserId: owner, issuedByUserId: 'j1',
    });

  it('USER can only check out own ticket (IDOR guard)', () => {
    expect(TicketPolicy.canCheckOut(user, ticketOf('u1', 'z1'))).toBe(true);
    expect(TicketPolicy.canCheckOut({ ...user, id: 'other' }, ticketOf('u1', 'z1'))).toBe(false);
  });
  it('JUKIR can check out only in assigned zone', () => {
    expect(TicketPolicy.canCheckOut(jukir, ticketOf('u1', 'z1'))).toBe(true);
    expect(TicketPolicy.canCheckOut(jukirWrongZone, ticketOf('u1', 'z1'))).toBe(false);
  });
});

describe('DynamicTariff monotonicity (TRD §2.1)', () => {
  const p = { baseRateMotor: 2000n, baseRateCar: 5000n };
  const start = new Date('2026-01-01T00:00:00Z');
  const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);
  const fee = (h: number) => computeTariff(p, 'MOTOR', start, at(h)).rupiah;

  it('bills whole started hours', () => {
    expect(fee(0)).toBe(2000n); // first hour always charged
    expect(fee(1)).toBe(2000n);
    expect(fee(2)).toBe(4000n);
    expect(fee(2.5)).toBe(6000n);
  });
  it('is monotonic against duration', () => {
    let prev = 0n;
    for (let h = 0; h <= 10; h++) {
      const f = fee(h);
      expect(f).toBeGreaterThanOrEqual(prev);
      prev = f;
    }
  });
});

describe('Ticket state machine (TRD §18.5)', () => {
  const issued = (): Ticket =>
    new Ticket({
      id: 't1', ticketCode: 'C', zoneId: 'z1', plate: PlateNumber.parse('L1SB'),
      vehicleType: 'MOTOR', status: 'ISSUED', checkInAt: new Date(), checkOutAt: null,
      totalFee: null, ownerUserId: null, issuedByUserId: 'j1',
    });
  it('ISSUED → PAID → COMPLETED', () => {
    const paid = issued().markPaid(Money.fromRupiah(2000n), new Date());
    expect(paid.status).toBe('PAID');
    expect(paid.complete().status).toBe('COMPLETED');
  });
  it('rejects skipping PAID (ISSUED → COMPLETED throws)', () => {
    expect(() => issued().complete()).toThrowError();
  });
});
