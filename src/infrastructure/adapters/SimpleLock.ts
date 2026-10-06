import type { LockPort } from '../../usecases/ports/LockPort.js';

/**
 * Local-only lock for the MVP. PostgreSQL transactions and constraints remain
 * responsible for data consistency; a distributed lock can be added later.
 */
export class SimpleLock implements LockPort {
  async acquire(_key: string, _ttlMs: number): Promise<string> {
    return 'local-lock';
  }

  async release(_key: string, _token: string): Promise<void> {}
}
