import { DomainError } from '../errors/DomainError.js';

/** Immutable geographic coordinate with range validation (SuroPark §16.10). */
export class LocationCoordinate {
  private constructor(
    readonly latitude: number,
    readonly longitude: number,
  ) {}

  static parse(latitude: number, longitude: number): LocationCoordinate {
    if (
      typeof latitude !== 'number' ||
      typeof longitude !== 'number' ||
      Number.isNaN(latitude) ||
      Number.isNaN(longitude)
    ) {
      throw new DomainError('INVALID_COORDINATE', 'Koordinat GPS harus berupa angka.');
    }
    if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      throw new DomainError(
        'INVALID_COORDINATE',
        `Koordinat di luar rentang: lat=${latitude}, lng=${longitude}`,
      );
    }
    return new LocationCoordinate(latitude, longitude);
  }
}
