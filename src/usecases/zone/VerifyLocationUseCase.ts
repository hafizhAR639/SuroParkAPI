import { LocationCoordinate } from '../../domain/value-objects/LocationCoordinate.js';
import type { ZoneRepository, ZoneRecord } from '../ports/ZoneRepository.js';

/** Resolves which active parking zone a coordinate falls within (TRD §10.1). */
export class VerifyLocationUseCase {
  constructor(private readonly zones: ZoneRepository) {}

  async execute(latitude: number, longitude: number): Promise<ZoneRecord | null> {
    const coord = LocationCoordinate.parse(latitude, longitude);
    return this.zones.findZoneContaining(coord.latitude, coord.longitude);
  }
}
