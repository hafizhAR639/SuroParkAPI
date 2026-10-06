/**
 * Distributed lock port (TRD §18.2). `acquire` returns an opaque token that MUST be
 * passed to `release` so a caller can only release its own lock — the fencing-token
 * fix for finding F2. The real value/authoritativeness of correctness comes from the
 * DB UNIQUE index (F3); the lock is only an optimization to cut DB load.
 */
export interface LockPort {
  acquire(key: string, ttlMs: number): Promise<string | null>;
  release(key: string, token: string): Promise<void>;
}
