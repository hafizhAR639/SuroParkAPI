import type { Actor } from '../../domain/entities/Actor.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      actor?: Actor;
      /** Raw body captured by express.json verify hook for webhook signature checks. */
      rawBody?: Buffer;
    }
  }
}

export {};
