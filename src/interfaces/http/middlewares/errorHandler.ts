import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { DomainError } from '../../../domain/errors/DomainError.js';
import { logger } from '../../../infrastructure/logging/logger.js';

const DOMAIN_STATUS: Record<string, number> = {
  INVALID_PLATE: 400,
  INVALID_COORDINATE: 400,
  INVALID_MONEY: 400,
  TICKET_NOT_FOUND: 404,
  FORBIDDEN: 403,
  OUT_OF_ZONE: 422,
  INVALID_TRANSITION: 409,
  ACTIVE_TICKET_EXISTS: 409,
  CONCURRENT_CONFLICT: 409,
};

/**
 * Central error→HTTP mapping (TRD §18.5): the domain carries semantic codes, the status code
 * is chosen only here. Internal errors never leak stack traces; a correlation errorId is returned.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  const errorId = randomUUID().slice(0, 8);

  if (err instanceof DomainError) {
    const status = DOMAIN_STATUS[err.code] ?? 400;
    res.status(status).json({ error: err.code, message: err.message, errorId });
    return;
  }

  const e = err as { code?: string; isBoom?: boolean };
  if (e?.code === 'E_AI_OPEN_CIRCUIT') {
    res.status(503).json({ error: 'payment_unavailable', errorId });
    return;
  }

  logger.error({ errorId, err: (err as Error)?.message }, 'unhandled error');
  res.status(500).json({ error: 'internal_error', errorId });
}

/** Wraps async controllers so rejected promises reach the error handler. */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
