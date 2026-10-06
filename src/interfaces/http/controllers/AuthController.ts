import type { Request, Response } from 'express';
import type { AuthUseCase } from '../../../usecases/auth/AuthUseCase.js';
import { asyncHandler } from '../middlewares/errorHandler.js';

function deviceId(req: Request): string {
  return req.header('x-device-id') ?? 'unknown-device';
}

export function AuthController(auth: AuthUseCase) {
  return {
    login: asyncHandler(async (req: Request, res: Response) => {
      const { phone, password } = req.body as { phone: string; password: string };
      const pair = await auth.login(phone, password, deviceId(req));
      if (pair === null) {
        // Uniform message + status; no user enumeration (TRD §16.2).
        res.status(401).json({ error: 'invalid_credentials', message: 'Kredensial salah.' });
        return;
      }
      res.json(pair);
    }),

    refresh: asyncHandler(async (req: Request, res: Response) => {
      const { refreshToken } = req.body as { refreshToken: string };
      const pair = await auth.refresh(refreshToken, deviceId(req));
      if (pair === null) {
        res.status(401).json({ error: 'invalid_refresh_token' });
        return;
      }
      res.json(pair);
    }),
  };
}
