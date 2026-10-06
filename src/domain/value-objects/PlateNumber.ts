import { DomainError } from '../errors/DomainError.js';

/**
 * Immutable value object for Indonesian vehicle plates (SuroPark §16.10).
 * Normalized to uppercase, no internal spaces. Format validated at construction.
 */
const PLATE_PATTERN = /^[A-Z]{1,2}\s?\d{1,4}\s?[A-Z]{0,3}$/;

export class PlateNumber {
  private constructor(readonly raw: string) {}

  /** Normalized form stored/indexed (e.g. "L1234SB"). */
  get value(): string {
    return this.raw.replace(/\s+/g, '');
  }

  static parse(input: string): PlateNumber {
    if (typeof input !== 'string' || input.trim() === '') {
      throw new DomainError('INVALID_PLATE', 'Plat nomor tidak boleh kosong.');
    }
    const upper = input.trim().toUpperCase();
    if (!PLATE_PATTERN.test(upper)) {
      throw new DomainError('INVALID_PLATE', `Format plat nomor tidak valid: ${input}`);
    }
    return new PlateNumber(upper);
  }

  equals(other: PlateNumber): boolean {
    return this.value === other.value;
  }
}
