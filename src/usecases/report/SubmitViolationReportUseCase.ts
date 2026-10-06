import type { Actor } from '../../domain/entities/Actor.js';
import { UserRole } from '../../domain/entities/Actor.js';
import { DomainError } from '../../domain/errors/DomainError.js';
import { LocationCoordinate } from '../../domain/value-objects/LocationCoordinate.js';
import type { IdGenerator } from '../ports/IdGenerator.js';

export interface SubmitReportInput {
  readonly actor: Actor;
  readonly latitude: number;
  readonly longitude: number;
  readonly description: string;
  /** Object key from a presigned upload — never a raw file body (TRD F9). */
  readonly photoObjectKey: string | null;
}

export interface SubmitReportResult {
  readonly reportId: string;
}

/**
 * Accepts a report in the MVP. Persistence and background processing can be added
 * after the main parking flow is validated.
 */
export class SubmitViolationReportUseCase {
  constructor(
    private readonly ids: IdGenerator,
  ) {}

  async execute(input: SubmitReportInput): Promise<SubmitReportResult> {
    if (input.actor.role !== UserRole.USER) {
      throw new DomainError('FORBIDDEN', 'Hanya warga yang dapat melayangkan laporan.');
    }
    LocationCoordinate.parse(input.latitude, input.longitude); // validates range

    const reportId = this.ids.uuid();
    return { reportId };
  }
}
