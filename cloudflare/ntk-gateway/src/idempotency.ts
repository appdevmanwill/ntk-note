/**
 * NTK Note — Cloud Storage Upload Idempotency Helper
 *
 * Checks if a requested objectId has already been recorded for this user and purpose.
 * If already recorded, returns the existing record immediately — bypassing quota checks and R2 writes.
 * Used by POST /v1/storage/upload and verified by production test suites.
 */

export interface IdempotentKV {
  get<T = unknown>(key: string, type?: 'text' | 'json' | 'arrayBuffer' | 'stream'): Promise<T | null>;
}

export interface IdempotencyEnv {
  NTK_CONFIG: IdempotentKV;
}

export interface UserFileRecord {
  id: string;
  uid: string;
  purpose: string;
  fileName: string;
  storageKey: string;
  size: number;
  mimeType: string;
  createdAt: string;
}

export async function getUserFileRecord(
  env: IdempotencyEnv,
  uid: string,
  purpose: string,
  id: string
): Promise<UserFileRecord | null> {
  return env.NTK_CONFIG.get<UserFileRecord>(`user-file:${uid}:${purpose}:${id}`, 'json');
}

export async function checkUploadIdempotency(
  env: IdempotencyEnv,
  uid: string,
  purpose: string,
  objectId: string
): Promise<{ isIdempotent: true; record: UserFileRecord } | { isIdempotent: false }> {
  if (!objectId || !objectId.startsWith('obj_')) {
    return { isIdempotent: false };
  }
  const existingRecord = await getUserFileRecord(env, uid, purpose, objectId);
  if (existingRecord) {
    return { isIdempotent: true, record: existingRecord };
  }
  return { isIdempotent: false };
}
