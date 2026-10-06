import type { NextFunction, Request, Response } from 'express';
import type { JwtService } from '../../../infrastructure/auth/JwtService.js';
import type { KyselyUserRepository } from '../../../infrastructure/database/repositories/KyselyUserRepository.js';
import type { UserRole } from '../../../domain/entities/Actor.js';

/** Verifies the access JWT and loads the ABAC actor (assigned zones / shift) for the request. */
export function authMiddleware(jwt: JwtService, users: KyselyUserRepository) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const claims = await jwt.verifyAccess(header.slice('Bearer '.length));
    if (claims === null) {
      res.status(401).json({ error: 'invalid_token' });
      return;
    }
    req.actor = await users.buildActor(claims.sub, claims.role);
    next();
  };
}

/** Coarse RBAC gate (ABAC ownership/zone checks live in the use cases via TicketPolicy). */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.actor || !roles.includes(req.actor.role)) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    next();
  };
}
