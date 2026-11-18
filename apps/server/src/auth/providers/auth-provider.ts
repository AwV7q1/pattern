/**
 * A way to prove who you are. `local` (email + password) ships today; an
 * OIDC provider (Authentik, Keycloak, Google…) implements the redirect flow
 * and resolves to the same `ResolvedIdentity`, then `AuthService.signIn`
 * links it to a `User` through the `Identity` table. Controllers, sessions
 * and guards do not change.
 */
export interface ResolvedIdentity {
  /** `local` or `oidc:<name>`. */
  provider: string;
  /** Stable id at the provider (OIDC `sub`; lowercased email for local). */
  subject: string;
  email: string;
  displayName?: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  kind: 'password' | 'redirect';
}

export interface AuthProvider {
  readonly info: ProviderInfo;
}

export const AUTH_PROVIDERS = Symbol('AUTH_PROVIDERS');
