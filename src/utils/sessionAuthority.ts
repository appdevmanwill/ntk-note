/**
 * Central Confirmed-Session Authority (NTK Note Security Invariant)
 *
 * CANONICAL SECURITY INVARIANT:
 * Account-bound user actions may execute ONLY when:
 * 1. Firebase auth UID exists and is confirmed.
 * 2. Store/workspace UID exists and is confirmed.
 * 3. Firebase UID === Store UID.
 * 4. (If applicable) The action's captured/expected session UID === that confirmed UID.
 *
 * If ANY identity differs or is missing/transitioning, operations must FAIL CLOSED.
 */

import { auth } from '@/utils/firebase';

export const INVALID_UID_KEYWORDS = new Set([
  'guest',
  'unknown',
  'null',
  'undefined',
  'default',
  'anonymous',
  '[object object]',
]);

/**
 * Validates that a UID is a genuine confirmed Firebase identity.
 * Rejects null, undefined, empty/whitespace strings, and pseudo-identity keywords.
 * Note: A real unique Firebase anonymous UID (e.g. 'anon-abc-123') is accepted.
 */
export const getConfirmedUid = (uid?: string | null): string | null => {
  if (!uid || typeof uid !== 'string') return null;
  const trimmed = uid.trim();
  if (!trimmed) return null;
  if (INVALID_UID_KEYWORDS.has(trimmed.toLowerCase())) return null;
  return trimmed;
};

/**
 * Resolves whether the application currently has a coherent, confirmed Firebase session.
 * STRICT INVARIANT:
 * authUid must be valid AND storeUid must be valid AND authUid === storeUid.
 * If either is missing, or if they mismatch (transition in flight), returns null.
 */
export const resolveConfirmedUid = (
  authUid?: string | null,
  storeUid?: string | null
): string | null => {
  const confirmedAuth = getConfirmedUid(authUid);
  const confirmedStore = getConfirmedUid(storeUid);
  if (!confirmedAuth || !confirmedStore) return null;
  if (confirmedAuth !== confirmedStore) return null;
  return confirmedAuth;
};

/**
 * Checks if a session is currently confirmed, optionally asserting that it matches
 * the expected session UID captured at render or event attachment time.
 */
export const isConfirmedSession = (
  currentAuthUid?: string | null,
  currentStoreUid?: string | null,
  expectedSessionUid?: string | null
): boolean => {
  const confirmed = resolveConfirmedUid(currentAuthUid, currentStoreUid);
  if (!confirmed) return false;
  if (expectedSessionUid !== undefined && expectedSessionUid !== null) {
    const expected = getConfirmedUid(expectedSessionUid);
    if (!expected || expected !== confirmed) return false;
  }
  return true;
};

/**
 * Strict Confirmed Session Authority (Section 17).
 * Unlike generic session checks, expectedSessionUid is MANDATORY and must be a valid,
 * confirmed UID.
 * Returns true if and only if:
 * 1. currentAuthUid is valid.
 * 2. currentStoreUid is valid.
 * 3. expectedSessionUid is valid.
 * 4. currentAuthUid === currentStoreUid === expectedSessionUid.
 * Otherwise returns false (FAIL CLOSED).
 */
export const isStrictConfirmedSession = (
  currentAuthUid: string | null | undefined,
  currentStoreUid: string | null | undefined,
  expectedSessionUid: string | null | undefined
): boolean => {
  const expected = getConfirmedUid(expectedSessionUid);
  if (!expected) return false;
  const confirmed = resolveConfirmedUid(currentAuthUid, currentStoreUid);
  if (!confirmed) return false;
  return confirmed === expected;
};

export interface SessionAuthorityOverrides {
  currentAuthUid?: string | null;
  currentStoreUid?: string | null;
}

/**
 * Decoupled auth UID getter registry to allow ambient auth lookups without
 * directly mutating Firebase Auth internal state during testing or transitions.
 */
type AuthUidGetter = () => string | null;
let activeAuthUidGetter: AuthUidGetter = () => {
  try {
    return auth?.currentUser?.uid ?? null;
  } catch {
    return null;
  }
};

export const setAuthUidGetter = (getter: AuthUidGetter): void => {
  activeAuthUidGetter = getter;
};

export const getAuthUid = (): string | null => {
  try {
    return activeAuthUidGetter();
  } catch {
    return null;
  }
};

/**
 * Decoupled store UID getter registry to prevent circular dependencies
 * between store/index.ts and service modules.
 */
type StoreUidGetter = () => string | null;
let activeStoreUidGetter: StoreUidGetter = () => null;

export const setStoreUidGetter = (getter: StoreUidGetter): void => {
  activeStoreUidGetter = getter;
};

export const getStoreUid = (): string | null => {
  try {
    return activeStoreUidGetter();
  } catch {
    return null;
  }
};

/**
 * Verifies that an operation requested for `requestedUid` is authorized by the current
 * confirmed session (or explicit overrides).
 * Returns true only when:
 * 1. requestedUid is a valid confirmed UID.
 * 2. Active auth UID exists and matches active store UID.
 * 3. That confirmed session UID === requestedUid.
 * Otherwise returns false (FAIL CLOSED).
 */
export const isAuthorizedSession = (
  requestedUid: string | null | undefined,
  overrides?: SessionAuthorityOverrides
): boolean => {
  const target = getConfirmedUid(requestedUid);
  if (!target) return false;

  const authUid = overrides?.currentAuthUid !== undefined
    ? overrides.currentAuthUid
    : getAuthUid();
  const storeUid = overrides?.currentStoreUid !== undefined
    ? overrides.currentStoreUid
    : getStoreUid();

  return isStrictConfirmedSession(authUid, storeUid, target);
};

