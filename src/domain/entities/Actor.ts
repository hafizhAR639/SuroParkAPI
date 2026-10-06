export const UserRole = {
  USER: 'USER',
  JUKIR: 'JUKIR',
  INSPECTOR: 'INSPECTOR',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

/**
 * Actor with ABAC attributes (TRD §16.3). RBAC role alone is insufficient:
 * JUKIR carries assigned zones and an active-shift flag for policy checks.
 */
export interface Actor {
  readonly id: string;
  readonly role: UserRole;
  readonly assignedZoneIds: readonly string[];
  readonly shiftActive: boolean;
}
