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
