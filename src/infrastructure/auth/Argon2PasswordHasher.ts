import { hash, verify } from '@node-rs/argon2';

/** Argon2id per TRD §16.2: memory ≥ 64 MiB, timeCost ≥ 3, parallelism 1. */
const ARGON2_OPTIONS = {
  algorithm: 2, // argon2id
  memoryCost: 64 * 1024,
  timeCost: 3,
  parallelism: 1,
} as const;

export class Argon2PasswordHasher {
  async hash(plain: string): Promise<string> {
    return hash(plain, ARGON2_OPTIONS);
  }
  async verify(encoded: string, plain: string): Promise<boolean> {
    try {
      return await verify(encoded, plain);
    } catch {
      return false;
    }
  }
}
