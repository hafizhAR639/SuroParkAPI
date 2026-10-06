import { describe, it, expect } from 'vitest';
import { IssueTicketUseCase } from '../../src/usecases/ticket/IssueTicketUseCase.js';
import { DomainError } from '../../src/domain/errors/DomainError.js';
import type { Actor } from '../../src/domain/entities/Actor.js';
import { InMemoryTicketRepository, ZONE, makeLock, fakeClock, fakeIds, zoneRepoWith } from './fakes.js';

const user: Actor = { id: 'u1', role: 'USER', assignedZoneIds: [], shiftActive: false };
const body = {
  vehiclePlate: 'L1234SB', vehicleType: 'MOTOR' as const,
  latitude: -7.25, longitude: 112.75, ownerUserId: 'u1',
};

function buildRepo() {
  const repo = new InMemoryTicketRepository();
  return repo;
}

function useCase(repo: InMemoryTicketRepository, lockAvailable: boolean) {
  return new IssueTicketUseCase(
    repo, makeLock(lockAvailable), zoneRepoWith(ZONE), fakeClock(), fakeIds(),
  );
}

async function fireAll(uc: IssueTicketUseCase, actor: Actor, n: number) {
  return Promise.allSettled(
    Array.from({ length: n }, () => uc.execute({ ...body, actor })),
  );
}

describe('Invariant I1 — one plate, at most one active ticket', () => {
  it('with Redis lock healthy: exactly 1 of 50 concurrent check-ins succeeds', async () => {
    const repo = buildRepo();
    const results = await fireAll(useCase(repo, true), user, 50);
    const created = results.filter((r) => r.status === 'fulfilled');
    expect(created).toHaveLength(1);
    expect(repo.activeCountForPlate(body.vehiclePlate)).toBe(1);
  });

  it('with Redis DOWN (lock always denied): exactly 1 of 50 still succeeds via DB unique index (C1/C15)', async () => {
    const repo = buildRepo();
    const results = await fireAll(useCase(repo, false), user, 50);
    const created = results.filter((r) => r.status === 'fulfilled');
    expect(created).toHaveLength(1); // I1 holds even with the lock gone — F2/F3 proven
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(49);
    for (const r of rejected) {
      const reason = (r as PromiseRejectedResult).reason as DomainError;
      expect(reason).toBeInstanceOf(DomainError);
      expect(reason.code).toBe('ACTIVE_TICKET_EXISTS');
    }
    expect(repo.activeCountForPlate(body.vehiclePlate)).toBe(1);
  });

  it('different plates do not contend', async () => {
    const repo = buildRepo();
    const uc = useCase(repo, false);
    const results = await Promise.allSettled([
      uc.execute({ ...body, actor: user }),
      uc.execute({ ...body, actor: user, vehiclePlate: 'B9999AA' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
  });
});

describe('Spatial & policy guards', () => {
  it('rejects check-in outside a zone with OUT_OF_ZONE', async () => {
    const repo = buildRepo();
    const uc = new IssueTicketUseCase(repo, makeLock(true), zoneRepoWith(null), fakeClock(), fakeIds());
    await expect(uc.execute({ ...body, actor: user })).rejects.toMatchObject({ code: 'OUT_OF_ZONE' });
  });

  it('rejects an off-shift JUKIR with FORBIDDEN (F5)', async () => {
    const repo = buildRepo();
    const uc = useCase(repo, true);
    const offShift: Actor = { id: 'j9', role: 'JUKIR', assignedZoneIds: ['z1'], shiftActive: false };
    await expect(uc.execute({ ...body, actor: offShift, ownerUserId: null })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
