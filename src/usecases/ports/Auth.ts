import type { UserRole } from '../../domain/entities/Actor.js';

export interface UserCredential {
  readonly id: string;
  readonly role: UserRole;
  readonly passwordHash: string;
}

export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(encoded: string, plain: string): Promise<boolean>;
}

export interface TokenIssuer {
  signAccess(claims: { readonly sub: string; readonly role: UserRole }): Promise<string>;
}

export interface UserStore {
  findCredentialByPhone(phone: string): Promise<UserCredential | null>;
  findRoleById(id: string): Promise<UserRole | null>;
}

export interface RefreshTokenStore {
  issue(userId: string, deviceId: string, familyId: string): Promise<{ token: string }>;
  /** Returns a fresh token on rotation, or null when invalid/revoked/expired/mismatched. */
  rotate(token: string, deviceId: string): Promise<{ token: string } | null>;
  findUserId(token: string): Promise<string | null>;
}
