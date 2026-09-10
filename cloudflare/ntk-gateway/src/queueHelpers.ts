// Real, Production-Grade Helper Functions for Media and Reminder Cleanup Queues
// Factored out for route handling and deterministic automated testing

export type StoragePurpose = 'profilePhotos' | 'images' | 'voiceNotes' | 'attachments' | 'backups' | 'exports';

export interface SimpleKVNamespace {
  get<T = string>(key: string, type?: 'text' | 'json'): Promise<T | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface PendingMediaIndexItem {
  purpose: StoragePurpose;
  objectId: string;
  queuedAt?: string;
  retryCount?: number;
  lastAttemptAt?: string | null;
  nextEligibleAttemptAt?: string | null;
}

export interface PendingMediaMarker {
  uid: string;
  purpose: StoragePurpose;
  objectId: string;
  queuedAt: string;
  retryCount: number;
  lastAttemptAt: string | null;
  nextEligibleAttemptAt: string | null;
}

export interface MediaRetryResult {
  markerUpdated: boolean;
  indexUpdated: boolean;
  atCapacity: boolean;
  retryStatePersisted: boolean;
  indexReadFailed?: boolean;
  updatedRetries?: number;
  nextEligibleAttemptAt?: string;
}

export interface RemoveMediaMarkerResult {
  markerDeleted: boolean;
  indexUpdated: boolean;
  wasPresent: boolean;
  indexReadFailed?: boolean;
}

export type ReadPendingMediaIndexResult =
  | { ok: true; items: PendingMediaIndexItem[] }
  | { ok: false; code: 'QUEUE_STATE_UNAVAILABLE'; message: string };

/**
 * Reads the canonical pending media cleanup index from KV in a strictly fail-closed manner.
 * - Genuine absent key (null) -> { ok: true, items: [] }
 * - Array data -> { ok: true, items: raw }
 * - Non-array or malformed data -> { ok: false, code: 'QUEUE_STATE_UNAVAILABLE', message: 'Cleanup will retry automatically.' }
 * - KV GET throws -> { ok: false, code: 'QUEUE_STATE_UNAVAILABLE', message: 'Cleanup will retry automatically.' }
 */
export async function readPendingMediaIndexFailClosed(
  kv: SimpleKVNamespace,
  uid: string
): Promise<ReadPendingMediaIndexResult> {
  const indexKey = `pending-media-cleanup-index:${uid}`;
  try {
    const raw = await kv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    if (raw === null) {
      return { ok: true, items: [] };
    }
    if (Array.isArray(raw)) {
      return { ok: true, items: raw };
    }
    console.error(`Malformed pending media cleanup index data at ${indexKey}`);
    return {
      ok: false,
      code: 'QUEUE_STATE_UNAVAILABLE',
      message: 'Cleanup will retry automatically.',
    };
  } catch (err) {
    console.error(`Failed to read pending media cleanup index from KV (${indexKey}):`, err);
    return {
      ok: false,
      code: 'QUEUE_STATE_UNAVAILABLE',
      message: 'Cleanup will retry automatically.',
    };
  }
}

export type ReadPendingReminderIndexResult =
  | { ok: true; items: string[] }
  | { ok: false; code: 'QUEUE_STATE_UNAVAILABLE'; message: string };

/**
 * Reads the canonical pending reminder cleanup index from KV in a strictly fail-closed manner.
 */
export async function readPendingReminderIndexFailClosed(
  kv: SimpleKVNamespace,
  uid: string
): Promise<ReadPendingReminderIndexResult> {
  const indexKey = `pending-reminder-cleanup-index:${uid}`;
  try {
    const raw = await kv.get<string[]>(indexKey, 'json');
    if (raw === null) {
      return { ok: true, items: [] };
    }
    if (Array.isArray(raw)) {
      return { ok: true, items: raw };
    }
    console.error(`Malformed pending reminder cleanup index data at ${indexKey}`);
    return {
      ok: false,
      code: 'QUEUE_STATE_UNAVAILABLE',
      message: 'Cleanup will retry automatically.',
    };
  } catch (err) {
    console.error(`Failed to read pending reminder cleanup index from KV (${indexKey}):`, err);
    return {
      ok: false,
      code: 'QUEUE_STATE_UNAVAILABLE',
      message: 'Cleanup will retry automatically.',
    };
  }
}

export type CheckStorageDeleteEligibilityResult =
  | { allowed: true; existingMarker: PendingMediaMarker | null }
  | { allowed: false; status: 429; code: 'RETRY_NOT_READY'; message: string; nextEligibleAttemptAt: string }
  | { allowed: false; status: 503; code: 'QUEUE_STATE_UNAVAILABLE'; message: string };

/**
 * Validates canonical queue state and server backoff before attempting physical storage deletion.
 * - If reading the canonical index fails (throws or malformed data), fails closed with 503 QUEUE_STATE_UNAVAILABLE.
 * - If a future backoff is active (nextEligibleAttemptAt > now), returns 429 RETRY_NOT_READY with zero storage calls.
 * - If canonical index read succeeds and backoff is expired or absent, allows proceeding to physical storage delete.
 */
export async function checkStorageDeleteEligibility(
  kv: SimpleKVNamespace,
  uid: string,
  purpose: StoragePurpose,
  objectId: string,
  nowMs = Date.now()
): Promise<CheckStorageDeleteEligibilityResult> {
  const indexReadRes = await readPendingMediaIndexFailClosed(kv, uid);
  if (!indexReadRes.ok) {
    return {
      allowed: false,
      status: 503,
      code: 'QUEUE_STATE_UNAVAILABLE',
      message: 'Cleanup will retry automatically.',
    };
  }

  const currentIndex = indexReadRes.items;
  const indexItem = currentIndex.find(item => item.purpose === purpose && item.objectId === objectId);

  const markerKey = `pending-media-cleanup:${uid}:${purpose}:${objectId}`;
  let existingMarker: PendingMediaMarker | null = null;
  if (indexItem) {
    existingMarker = {
      uid,
      purpose,
      objectId,
      queuedAt: indexItem.queuedAt || new Date(nowMs).toISOString(),
      retryCount: indexItem.retryCount || 0,
      lastAttemptAt: indexItem.lastAttemptAt || null,
      nextEligibleAttemptAt: indexItem.nextEligibleAttemptAt || null,
    };
  } else {
    // Historical compatibility fallback: direct marker read ONLY after canonical index read succeeded
    existingMarker = await kv.get<PendingMediaMarker>(markerKey, 'json').catch(() => null);
  }

  if (existingMarker && existingMarker.nextEligibleAttemptAt) {
    const nextEligibleMs = new Date(existingMarker.nextEligibleAttemptAt).getTime();
    if (!isNaN(nextEligibleMs) && nowMs < nextEligibleMs) {
      return {
        allowed: false,
        status: 429,
        code: 'RETRY_NOT_READY',
        message: 'Retry backoff active. Please wait before retrying deletion.',
        nextEligibleAttemptAt: existingMarker.nextEligibleAttemptAt,
      };
    }
  }

  return { allowed: true, existingMarker };
}

/**
 * Computes server-authoritative backoff duration based on actual failure attempts.
 * Retry 1: 30s
 * Retry 2: 60s (1 min)
 * Retry 3: 300s (5 min)
 * Retry 4: 900s (15 min)
 * Retry 5+: Exponential bounded to 3600s (1 hr)
 */
export function computeServerRetryBackoffMs(retryCount: number): number {
  if (retryCount <= 1) return 30 * 1000;
  if (retryCount === 2) return 60 * 1000;
  if (retryCount === 3) return 300 * 1000;
  if (retryCount === 4) return 900 * 1000;
  const expMinutes = Math.min(60, 15 * Math.pow(2, retryCount - 4));
  return expMinutes * 60 * 1000;
}

/**
 * Builds the initial server-authoritative state for a new pending media cleanup.
 */
export function buildInitialPendingMediaState(
  uid: string,
  purpose: StoragePurpose,
  objectId: string,
  nowIso = new Date().toISOString()
): PendingMediaMarker {
  return {
    uid,
    purpose,
    objectId,
    queuedAt: nowIso,
    retryCount: 0,
    lastAttemptAt: null,
    nextEligibleAttemptAt: nowIso,
  };
}

/**
 * Checks capacity and duplicate existence before writing any new marker.
 */
export function canCreatePendingMediaMarker(
  currentIndex: PendingMediaIndexItem[],
  purpose: StoragePurpose,
  objectId: string,
  maxItems = 50
): { allowed: boolean; isDuplicate: boolean; atCapacity: boolean } {
  const existing = currentIndex.find(
    item => item.purpose === purpose && item.objectId === objectId
  );
  if (existing) {
    return { allowed: false, isDuplicate: true, atCapacity: false };
  }
  if (currentIndex.length >= maxItems) {
    return { allowed: false, isDuplicate: false, atCapacity: true };
  }
  return { allowed: true, isDuplicate: false, atCapacity: false };
}

/**
 * Advances media retry state after a real transient physical deletion failure.
 * THE INDEX IS THE CANONICAL SOURCE OF TRUTH.
 * Capacity check occurs before any write. The index is updated FIRST.
 */
export async function advanceServerMediaRetry(
  kv: SimpleKVNamespace,
  uid: string,
  purpose: StoragePurpose,
  objectId: string,
  existingMarker?: PendingMediaMarker | null,
  nowMs = Date.now()
): Promise<MediaRetryResult> {
  const markerKey = `pending-media-cleanup:${uid}:${purpose}:${objectId}`;
  const indexKey = `pending-media-cleanup-index:${uid}`;

  const readRes = await readPendingMediaIndexFailClosed(kv, uid);
  if (!readRes.ok) {
    return {
      markerUpdated: false,
      indexUpdated: false,
      atCapacity: false,
      retryStatePersisted: false,
      indexReadFailed: true,
    };
  }
  const currentIndex = readRes.items;

  const idx = currentIndex.findIndex(item => item.purpose === purpose && item.objectId === objectId);

  // If item does NOT exist in index, verify capacity BEFORE writing
  if (idx === -1 && currentIndex.length >= 50) {
    // 50-item cap reached: DO NOT write! Prevent orphan KV key!
    return {
      markerUpdated: false,
      indexUpdated: false,
      atCapacity: true,
      retryStatePersisted: false,
      indexReadFailed: false,
    };
  }

  const currentRetries = existingMarker?.retryCount ?? (idx !== -1 ? currentIndex[idx].retryCount ?? 0 : 0);
  const updatedRetries = currentRetries + 1;
  const backoffMs = computeServerRetryBackoffMs(updatedRetries);
  const nextEligibleAttemptAt = new Date(nowMs + backoffMs).toISOString();
  const lastAttemptAt = new Date(nowMs).toISOString();
  const queuedAt = existingMarker?.queuedAt ?? (idx !== -1 ? currentIndex[idx].queuedAt ?? new Date(nowMs).toISOString() : new Date(nowMs).toISOString());

  const updatedMarker: PendingMediaMarker = {
    uid,
    purpose,
    objectId,
    queuedAt,
    retryCount: updatedRetries,
    lastAttemptAt,
    nextEligibleAttemptAt,
  };

  if (idx !== -1) {
    currentIndex[idx].retryCount = updatedRetries;
    currentIndex[idx].lastAttemptAt = lastAttemptAt;
    currentIndex[idx].nextEligibleAttemptAt = nextEligibleAttemptAt;
  } else {
    currentIndex.push({
      purpose,
      objectId,
      queuedAt,
      retryCount: updatedRetries,
      lastAttemptAt,
      nextEligibleAttemptAt,
    });
  }

  // Section 8 & 9: INDEX-FIRST. Write the canonical index FIRST!
  let indexUpdated = false;
  try {
    await kv.put(indexKey, JSON.stringify(currentIndex));
    indexUpdated = true;
  } catch (err) {
    console.error(`Failed to put pending media cleanup index (${indexKey}):`, err);
    // If index update fails, DO NOT write marker! State remains clean.
    return {
      markerUpdated: false,
      indexUpdated: false,
      atCapacity: false,
      retryStatePersisted: false,
      indexReadFailed: false,
    };
  }

  // Only after canonical index update succeeds, update the secondary direct marker
  let markerUpdated = false;
  try {
    await kv.put(markerKey, JSON.stringify(updatedMarker));
    markerUpdated = true;
  } catch (err) {
    console.error(`Failed to put pending media cleanup marker (${markerKey}):`, err);
  }

  return {
    markerUpdated,
    indexUpdated: true,
    atCapacity: false,
    retryStatePersisted: markerUpdated, // Fully persisted only when both index and marker succeed
    indexReadFailed: false,
    updatedRetries,
    nextEligibleAttemptAt,
  };
}

/**
 * Removes a user's pending media cleanup marker and index entry on success or terminal failure.
 * Section 10: If marker deletion fails unexpectedly, KEEP the index entry so discoverability is never lost!
 */
export async function removeUserPendingMediaCleanupMarker(
  kv: SimpleKVNamespace,
  uid: string,
  purpose: StoragePurpose,
  objectId: string
): Promise<RemoveMediaMarkerResult> {
  const markerKey = `pending-media-cleanup:${uid}:${purpose}:${objectId}`;
  const indexKey = `pending-media-cleanup-index:${uid}`;

  const readRes = await readPendingMediaIndexFailClosed(kv, uid);
  if (!readRes.ok) {
    return {
      markerDeleted: false,
      indexUpdated: false,
      wasPresent: false,
      indexReadFailed: true,
    };
  }
  const currentIndex = readRes.items;

  const nextIndex = currentIndex.filter(item => !(item.purpose === purpose && item.objectId === objectId));
  const wasPresent = nextIndex.length !== currentIndex.length;

  let markerDeleted = false;
  try {
    await kv.delete(markerKey);
    markerDeleted = true;
  } catch (err) {
    console.error(`Failed to delete marker ${markerKey}:`, err);
  }

  // Section 10: If marker deletion fails unexpectedly, KEEP the index entry!
  if (!markerDeleted) {
    return {
      markerDeleted: false,
      indexUpdated: false,
      wasPresent,
      indexReadFailed: false,
    };
  }

  let indexUpdated = false;
  if (wasPresent) {
    try {
      await kv.put(indexKey, JSON.stringify(nextIndex));
      indexUpdated = true;
    } catch (err) {
      console.error(`Failed to update index ${indexKey}:`, err);
    }
  } else {
    indexUpdated = true;
  }

  return {
    markerDeleted: true,
    indexUpdated,
    wasPresent,
    indexReadFailed: false,
  };
}

/**
 * Validates and deduplicates an incoming reminder cleanup request.
 * Sections 19-22: Bounds raw array to max 25 items BEFORE dedup, verifies string types, bounds lengths to 1-128 chars.
 */
export function validateReminderCleanupRequest(
  rawIds: unknown,
  maxBatch = 25
): { valid: true; cleanIds: string[] } | { valid: false; status: number; code: string; message: string } {
  let list: unknown[] = [];
  if (Array.isArray(rawIds)) {
    list = rawIds;
  } else if (typeof rawIds === 'string') {
    list = [rawIds];
  } else {
    return {
      valid: false,
      status: 400,
      code: 'INVALID_REQUEST_BODY',
      message: 'reminderIds must be an array of string identifiers.',
    };
  }

  // Section 20: RAW ARRAY LIMIT CHECK FIRST (before map, trim, filter, deduplicate!)
  if (list.length > maxBatch) {
    return {
      valid: false,
      status: 400,
      code: 'REQUEST_TOO_LARGE',
      message: `Request exceeds maximum batch size of ${maxBatch} reminder IDs.`,
    };
  }

  if (list.length === 0) {
    return {
      valid: false,
      status: 400,
      code: 'EMPTY_REMINDER_IDS',
      message: 'At least one valid reminder ID is required.',
    };
  }

  // Section 21 & 22: Reject non-string items and validate lengths
  const cleanList: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') {
      return {
        valid: false,
        status: 400,
        code: 'INVALID_REMINDER_ID',
        message: 'All reminder IDs must be strings.',
      };
    }
    const trimmed = item.trim();
    if (trimmed.length < 1 || trimmed.length > 128) {
      return {
        valid: false,
        status: 400,
        code: 'INVALID_REMINDER_ID_LENGTH',
        message: 'Reminder ID must be between 1 and 128 characters.',
      };
    }
    cleanList.push(trimmed);
  }

  // Internal deduplication within the same request:
  const cleanIds = Array.from(new Set(cleanList));

  return { valid: true, cleanIds };
}

/**
 * Filters requested reminder IDs against the user's durable server queue.
 * Sections 16-18: Unqueued IDs are excluded so they NEVER trigger Firestore REST verification reads.
 */
export function filterQueuedReminderIds(
  existingQueue: string[],
  requestedIds: string[]
): { queuedIds: string[]; unqueuedCount: number } {
  const queuedIds = requestedIds.filter(id => existingQueue.includes(id));
  return {
    queuedIds,
    unqueuedCount: requestedIds.length - queuedIds.length,
  };
}


/**
 * Merges new reminder IDs into existing user queue using all-or-nothing capacity semantics.
 * If existing + new > maxTotal (100), rejects with atCapacity: true without writing or truncating.
 */
export function mergeReminderCleanupQueue(
  existing: string[],
  cleanIds: string[],
  maxTotal = 100
): {
  unchanged: boolean;
  atCapacity: boolean;
  combined: string[];
  newIds: string[];
} {
  const newIds = cleanIds.filter(id => !existing.includes(id));
  if (newIds.length === 0) {
    return {
      unchanged: true,
      atCapacity: false,
      combined: existing,
      newIds: [],
    };
  }

  if (existing.length + newIds.length > maxTotal) {
    return {
      unchanged: false,
      atCapacity: true,
      combined: existing,
      newIds,
    };
  }

  return {
    unchanged: false,
    atCapacity: false,
    combined: [...existing, ...newIds],
    newIds,
  };
}

/**
 * Validates with Firestore REST API that a reminder is a genuine orphan:
 * 1. Reminder exists in users/{uid}/reminders/{reminderId}
 * 2. Reminder has a valid noteId (rejects standalone reminders)
 * 3. The associated note users/{uid}/notes/{noteId} is GENUINELY ABSENT (404)
 */
export async function validateOrphanReminder(
  fetchFn: typeof fetch,
  firebaseProjectId: string,
  token: string,
  uid: string,
  reminderId: string
): Promise<{ valid: true; noteId: string } | { valid: false; status: number; code: string; message: string }> {
  const base = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`;
  const reminderUrl = `${base}/reminders/${encodeURIComponent(reminderId)}`;

  let reminderRes: Response;
  try {
    reminderRes = await fetchFn(reminderUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return {
      valid: false,
      status: 503,
      code: 'FIRESTORE_COMMUNICATION_ERROR',
      message: 'Failed to communicate with Firestore for reminder verification.',
    };
  }

  if (reminderRes.status === 404) {
    return {
      valid: false,
      status: 404,
      code: 'REMINDER_NOT_FOUND',
      message: `Reminder "${reminderId}" does not exist in Firestore.`,
    };
  }

  if (!reminderRes.ok) {
    return {
      valid: false,
      status: reminderRes.status === 403 ? 403 : 400,
      code: 'REMINDER_ACCESS_DENIED',
      message: `Access denied or invalid reminder document for "${reminderId}".`,
    };
  }

  let reminderData: any;
  try {
    reminderData = await reminderRes.json();
  } catch {
    return {
      valid: false,
      status: 502,
      code: 'INVALID_FIRESTORE_RESPONSE',
      message: 'Received invalid JSON response from Firestore.',
    };
  }

  const noteId = reminderData?.fields?.noteId?.stringValue;
  if (!noteId || typeof noteId !== 'string' || !noteId.trim()) {
    return {
      valid: false,
      status: 400,
      code: 'STANDALONE_REMINDER_DENIED',
      message: `Reminder "${reminderId}" is a standalone reminder and cannot enter orphan cleanup queue.`,
    };
  }

  // Check if note is genuinely absent:
  const noteUrl = `${base}/notes/${encodeURIComponent(noteId)}`;
  let noteRes: Response;
  try {
    noteRes = await fetchFn(noteUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return {
      valid: false,
      status: 503,
      code: 'FIRESTORE_COMMUNICATION_ERROR',
      message: 'Failed to communicate with Firestore for note verification.',
    };
  }

  if (noteRes.status === 200) {
    // Note STILL EXISTS! Reminder is not an orphan!
    return {
      valid: false,
      status: 409,
      code: 'REMINDER_NOT_ORPHANED',
      message: `Note "${noteId}" still exists in Firestore. Reminder "${reminderId}" is not orphaned.`,
    };
  }

  if (noteRes.status === 404) {
    // Note is absent! Legitimate orphan!
    return { valid: true, noteId };
  }

  return {
    valid: false,
    status: 400,
    code: 'NOTE_VERIFICATION_FAILED',
    message: `Unexpected status ${noteRes.status} while verifying note absence for "${noteId}".`,
  };
}

/**
 * Validates with Firestore REST API before removing a reminder from the server cleanup queue.
 * Requires the reminder document to be absent (404) in Firestore.
 */
export async function validateReminderCleanupDelete(
  fetchFn: typeof fetch,
  firebaseProjectId: string,
  token: string,
  uid: string,
  reminderId: string
): Promise<{ canDelete: true } | { canDelete: false; status: number; code: string; message: string }> {
  const reminderUrl = `https://firestore.googleapis.com/v1/projects/${firebaseProjectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}/reminders/${encodeURIComponent(reminderId)}`;

  let res: Response;
  try {
    res = await fetchFn(reminderUrl, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    return {
      canDelete: false,
      status: 503,
      code: 'FIRESTORE_COMMUNICATION_ERROR',
      message: 'Failed to communicate with Firestore to verify reminder deletion.',
    };
  }

  if (res.status === 200) {
    // Reminder STILL EXISTS! Cannot clear queue marker!
    return {
      canDelete: false,
      status: 409,
      code: 'CLEANUP_NOT_COMPLETE',
      message: `Reminder "${reminderId}" still exists in Firestore. Complete deletion before clearing queue.`,
    };
  }

  if (res.status === 404) {
    // Document absent: safe to remove from server queue
    return { canDelete: true };
  }

  return {
    canDelete: false,
    status: 400,
    code: 'REMINDER_VERIFICATION_FAILED',
    message: `Unexpected status ${res.status} checking reminder document "${reminderId}".`,
  };
}
