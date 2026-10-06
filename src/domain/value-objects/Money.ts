import { DomainError } from '../errors/DomainError.js';

/**
 * Money as an integer amount of whole Rupiah (TRD §18.5: never float).
 * Stored in DB as NUMERIC and mapped to/from bigint at the repository boundary.
 */
export class Money {
  private constructor(readonly rupiah: bigint) {}

  static fromRupiah(amount: bigint | number): Money {
    const value = typeof amount === 'bigint' ? amount : BigInt(Math.trunc(amount));
    if (value < 0n) {
      throw new DomainError('INVALID_MONEY', 'Jumlah uang tidak boleh negatif.');
    }
    return new Money(value);
  }

  /** Parse a DB NUMERIC string such as "3000" or "3000.00". */
  static fromNumericString(raw: string): Money {
    const [whole] = raw.split('.');
    return Money.fromRupiah(BigInt(whole ?? '0'));
  }

  add(other: Money): Money {
    return new Money(this.rupiah + other.rupiah);
  }

  multiply(factor: bigint): Money {
    return new Money(this.rupiah * factor);
  }

  /** Serialize for DB (NUMERIC-compatible integer string). */
  toNumericString(): string {
    return this.rupiah.toString();
  }
}
