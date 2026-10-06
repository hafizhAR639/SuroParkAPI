import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';

/** Applies a strict Zod schema to req.body; 400 on any failure (TRD §16.10). */
export function validate(schema: ZodTypeAny) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: 'validation_error', issues: result.error.flatten().fieldErrors });
      return;
    }
    req.body = result.data;
    next();
  };
}
