import { describe, it, expect } from 'vitest';
import { PlateNumber } from '../../src/domain/value-objects/PlateNumber.js';
import { Money } from '../../src/domain/value-objects/Money.js';
import { LocationCoordinate } from '../../src/domain/value-objects/LocationCoordinate.js';

describe('PlateNumber value object', () => {
  it('normalizes to uppercase without spaces', () => {
    expect(PlateNumber.parse('l 1234 sb').value).toBe('L1234SB');
  });
  it('rejects malformed plates', () => {
    expect(() => PlateNumber.parse('1234')).toThrowError(/INVALID_PLATE|format/i);
  });
  it('rejects empty', () => {
    expect(() => PlateNumber.parse('   ')).toThrowError();
  });
});

describe('Money value object (no floats)', () => {
  it('parses DB NUMERIC strings', () => {
    expect(Money.fromNumericString('3000.00').rupiah).toBe(3000n);
  });
  it('rejects negative amounts', () => {
    expect(() => Money.fromRupiah(-1)).toThrowError();
  });
  it('serializes back to numeric string', () => {
    expect(Money.fromRupiah(5000n).add(Money.fromRupiah(1000n)).toNumericString()).toBe('6000');
  });
});

describe('LocationCoordinate', () => {
  it('accepts a Surabaya coordinate', () => {
    expect(LocationCoordinate.parse(-7.2575, 112.7521).latitude).toBe(-7.2575);
  });
  it('rejects out-of-range latitude', () => {
    expect(() => LocationCoordinate.parse(95, 0)).toThrowError();
  });
});
