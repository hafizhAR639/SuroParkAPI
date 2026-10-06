/**
 * Domain error taxonomy (TRD §18.5). Domain errors carry a semantic `code`,
 * never an HTTP status. The HTTP mapping lives in the interfaces layer.
 */
export type DomainErrorCode =
  | 'INVALID_PLATE'
  | 'INVALID_COORDINATE'
  | 'INVALID_MONEY'
  | 'INVALID_TRANSITION'
  | 'ACTIVE_TICKET_EXISTS'
  | 'TICKET_NOT_FOUND'
  | 'OUT_OF_ZONE'
  | 'CONCURRENT_CONFLICT'
  | 'FORBIDDEN';

export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
