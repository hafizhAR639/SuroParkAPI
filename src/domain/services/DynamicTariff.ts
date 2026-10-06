import { Money } from '../value-objects/Money.js';

export interface TariffParams {
  readonly baseRateMotor: bigint;
  readonly baseRateCar: bigint;
}

/**
 * Pure dynamic-pricing rule (TRD §2.1 core objective).
 * First hour billed at the base rate; each started additional hour adds base rate again.
 * Monotonically increasing against duration (verified by property-based test §18.6).
 */
export function computeTariff(
  params: TariffParams,
  vehicleType: 'MOTOR' | 'CAR' | 'TRUCK',
  checkInAt: Date,
  checkOutAt: Date,
): Money {
  if (checkOutAt.getTime() < checkInAt.getTime()) {
    return Money.fromRupiah(0n);
  }
  const base =
    vehicleType === 'MOTOR' ? params.baseRateMotor : params.baseRateCar;
  const elapsedMs = checkOutAt.getTime() - checkInAt.getTime();
  const hours = Math.max(1, Math.ceil(elapsedMs / 3_600_000)); // start-any-hour bills
  return Money.fromRupiah(base).multiply(BigInt(hours));
}
