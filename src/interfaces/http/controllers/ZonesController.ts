import type { Request, Response } from 'express';
import type { ZoneRepository } from '../../../usecases/ports/ZoneRepository.js';
import { asyncHandler } from '../middlewares/errorHandler.js';

/** GET /admin/zones — GeoJSON of active zones for the Dishub map (RBAC ADMIN, TRD §5.1). */
export function ZonesController(zones: ZoneRepository) {
  return {
    list: asyncHandler(async (_req: Request, res: Response) => {
      const rows = await zones.listActiveGeoJson();
      res.json({
        type: 'FeatureCollection',
        features: rows.map((z) => ({
          type: 'Feature',
          properties: { id: z.id, code: z.code, name: z.name },
          geometry: JSON.parse(z.geometry),
        })),
      });
    }),
  };
}
