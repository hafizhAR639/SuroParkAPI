import type { Request, Response } from 'express';
import type { SubmitViolationReportUseCase } from '../../../usecases/report/SubmitViolationReportUseCase.js';
import type { Actor } from '../../../domain/entities/Actor.js';
import { asyncHandler } from '../middlewares/errorHandler.js';

export function ReportController(submit: SubmitViolationReportUseCase) {
  return {
    submit: asyncHandler(async (req: Request, res: Response) => {
      const actor = req.actor as Actor | undefined;
      if (actor === undefined) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      const body = req.body as {
        latitude: number;
        longitude: number;
        description: string;
        photoObjectKey?: string;
      };
      const { reportId } = await submit.execute({
        actor,
        latitude: body.latitude,
        longitude: body.longitude,
        description: body.description,
        photoObjectKey: body.photoObjectKey ?? null,
      });
      res.status(201).json({ reportId, status: 'RECEIVED' });
    }),
  };
}
