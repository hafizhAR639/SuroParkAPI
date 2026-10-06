import { randomUUID, randomBytes } from 'node:crypto';
import type { Clock } from '../../usecases/ports/Clock.js';
import type { IdGenerator } from '../../usecases/ports/IdGenerator.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  uuid(): string {
    return randomUUID();
  }
  token(bytes = 16): string {
    return randomBytes(bytes).toString('hex');
  }
}
