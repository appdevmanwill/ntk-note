import { auth } from '@/utils/firebase';
import { getGatewayUrl, type StoragePurpose } from '@/utils/ntkAi';
import { recordWorkerRequest } from '@/utils/performanceMetrics';

export type { StoragePurpose };

export interface StorageUploadResult {
  objectId: string;
  fileName: string;
  size: number;
  mimeType: string;
  url: string;
  path: string;
  createdAt: string;
}

export interface StorageListItem {
  id: string;
  fileName: string;
  size: number;
  mimeType: string;
  storageKey: string;
  createdAt: string;
}

export interface StorageQuotaInfo {
  totalBytes: number;
  safetyTargetBytes: number;
  usagePercentage: number;
  purposes: Record<StoragePurpose, number>;
  guardStatus: 'ok' | 'attention' | 'warning' | 'critical';
}

const EMPTY_PURPOSES: Record<StoragePurpose, boolean> = {
  profilePhotos: false,
  images: false,
  voiceNotes: false,
  attachments: false,
  backups: false,
  exports: false,
};

async function getAuthToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error('You must be signed in to access cloud storage.');
  return user.getIdToken();
}

export async function getStorageAvailability(): Promise<Record<StoragePurpose, boolean>> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return { ...EMPTY_PURPOSES };
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return { ...EMPTY_PURPOSES };
    const data = await response.json() as { purposes: Record<StoragePurpose, boolean> };
    return data.purposes || { ...EMPTY_PURPOSES };
  } catch {
    return { ...EMPTY_PURPOSES };
  }
}

export async function getStorageQuota(): Promise<StorageQuotaInfo | null> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return null;
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/quota`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    return response.json() as Promise<StorageQuotaInfo>;
  } catch {
    return null;
  }
}

export class StorageUploadError extends Error {
  public readonly status: number;
  public readonly code: string;

  constructor(message: string, status: number, code = 'UPLOAD_FAILED') {
    super(message);
    this.name = 'StorageUploadError';
    this.status = status;
    this.code = code;
  }
}

export interface StorageUploadOptions {
  expectedUid?: string;
  signal?: AbortSignal;
}

export async function uploadStorageFile(
  file: File | Blob,
  purpose: StoragePurpose,
  customFileName?: string,
  noteId?: string,
  customObjectId?: string,
  options?: StorageUploadOptions
): Promise<StorageUploadResult> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) throw new Error('Cloud storage gateway is not configured.');

  // §20: Before obtaining token: auth.currentUser?.uid MUST equal expectedUid
  if (options?.expectedUid) {
    const currentUid = auth.currentUser?.uid;
    if (currentUid !== options.expectedUid) {
      throw new StorageUploadError(
        `Upload aborted: active user (${currentUid || 'none'}) does not match expected (${options.expectedUid}) before token.`,
        401,
        'AUTH_USER_MISMATCH'
      );
    }
  }

  const token = await getAuthToken();

  // §20: After obtaining token / before fetch: verify again where practical
  if (options?.expectedUid) {
    const currentUid = auth.currentUser?.uid;
    if (currentUid !== options.expectedUid) {
      throw new StorageUploadError(
        `Upload aborted: active user (${currentUid || 'none'}) does not match expected (${options.expectedUid}) after token.`,
        401,
        'AUTH_USER_MISMATCH'
      );
    }
  }

  const formData = new FormData();
  const name = customFileName || (file instanceof File ? file.name : 'file');
  formData.append('file', file, name);
  formData.append('purpose', purpose);
  if (noteId) {
    formData.append('noteId', noteId);
  }
  if (customObjectId) {
    formData.append('objectId', customObjectId);
  }

  recordWorkerRequest();
  const response = await fetch(`${baseUrl}/v1/storage/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
    signal: options?.signal,
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({ message: 'Upload failed.', code: 'UPLOAD_FAILED' })) as { message?: string; code?: string };
    const message = err.message || `Upload failed with status ${response.status}`;
    const code = err.code || `HTTP_${response.status}`;
    throw new StorageUploadError(message, response.status, code);
  }

  return response.json() as Promise<StorageUploadResult>;
}

export async function downloadStorageFile(
  purpose: StoragePurpose,
  objectId: string,
  fileName: string,
): Promise<Blob> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) throw new Error('Cloud storage gateway is not configured.');
  const token = await getAuthToken();

  const response = await fetch(`${baseUrl}/v1/storage/file/${purpose}/${objectId}/${encodeURIComponent(fileName)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Failed to download file (${response.status})`);
  }

  return response.blob();
}

export async function deleteStorageFile(
  purpose: StoragePurpose,
  objectId: string,
  immediateRetries = 2,
): Promise<boolean> {
  const res = await deleteStorageFileDetailed(purpose, objectId, immediateRetries);
  return res.ok;
}

export interface StorageDeleteResult {
  ok: boolean;
  status: number;
  isTerminal: boolean;
  code?: string;
  retryNotReady?: boolean;
  nextEligibleAttemptAt?: string;
}

export async function deleteStorageFileDetailed(
  purpose: StoragePurpose,
  objectId: string,
  immediateRetries = 2,
): Promise<StorageDeleteResult> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return { ok: false, status: 0, isTerminal: false };

  let lastStatus = 0;
  for (let attempt = 0; attempt <= immediateRetries; attempt++) {
    try {
      const token = await getAuthToken();
      const response = await fetch(`${baseUrl}/v1/storage/file/${purpose}/${objectId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      lastStatus = response.status;
      if (response.ok) return { ok: true, status: response.status, isTerminal: false };
      if (response.status === 404) return { ok: true, status: 404, isTerminal: false }; // idempotent success

      // Sections 27, 28, 30: Handle 429 RETRY_NOT_READY immediately. Stop retry loop!
      if (response.status === 429) {
        let payload: any = {};
        try { payload = await response.json(); } catch {}
        if (payload?.code === 'RETRY_NOT_READY') {
          return {
            ok: false,
            status: 429,
            isTerminal: false,
            code: 'RETRY_NOT_READY',
            retryNotReady: true,
            nextEligibleAttemptAt: payload.nextEligibleAttemptAt,
          };
        }
      }

      if (response.status === 403 || response.status === 400) {
        return { ok: false, status: response.status, isTerminal: true };
      }
    } catch {
      lastStatus = 0;
    }
    if (attempt < immediateRetries) {
      await new Promise(res => setTimeout(res, 250 * (attempt + 1)));
    }
  }
  return { ok: false, status: lastStatus, isTerminal: lastStatus === 403 || lastStatus === 400 };
}

export interface ServerPendingMediaItem {
  purpose: StoragePurpose;
  objectId: string;
  queuedAt?: string;
  retryCount?: number;
  lastAttemptAt?: string | null;
  nextEligibleAttemptAt?: string | null;
}

export async function recordServerPendingMediaCleanup(
  purpose: StoragePurpose,
  objectId: string,
  metadata?: {
    retryCount?: number;
    lastAttemptAt?: string | null;
    nextEligibleAttemptAt?: string | null;
  }
): Promise<boolean> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return false;
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/cleanup-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        purpose,
        objectId,
        ...(metadata || {}),
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchServerPendingMediaCleanups(): Promise<ServerPendingMediaItem[]> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return [];
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/cleanup-pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json() as { ok: boolean; items: ServerPendingMediaItem[] };
    return data.items || [];
  } catch {
    return [];
  }
}

export async function dismissServerPendingMediaCleanup(
  purpose: StoragePurpose,
  objectId: string,
): Promise<boolean> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return false;
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/cleanup-pending`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ purpose, objectId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getServerPendingReminderCleanups(): Promise<string[]> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return [];
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/reminder-cleanup-pending`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json() as { ok: boolean; reminderIds: string[] };
    return Array.isArray(data.reminderIds) ? data.reminderIds : [];
  } catch {
    return [];
  }
}

export async function queueServerPendingReminderCleanups(
  reminderIds: string[],
): Promise<boolean> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl || !reminderIds || reminderIds.length === 0) return false;
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/reminder-cleanup-pending`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reminderIds }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function deleteServerPendingReminderCleanups(
  reminderIds: string[],
): Promise<boolean> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl || !reminderIds || reminderIds.length === 0) return false;
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/reminder-cleanup-pending`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ reminderIds }),
    });
    return response.ok;
  } catch {
    return false;
  }
}


export async function listStorageFiles(
  purpose: StoragePurpose,
): Promise<StorageListItem[]> {
  const baseUrl = getGatewayUrl();
  if (!baseUrl) return [];
  try {
    const token = await getAuthToken();
    const response = await fetch(`${baseUrl}/v1/storage/list?purpose=${purpose}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    const data = await response.json() as { items: StorageListItem[] };
    return data.items || [];
  } catch {
    return [];
  }
}

export function buildStorageReference(purpose: StoragePurpose, objectId: string, fileName: string): string {
  return `storage:${purpose}:${objectId}:${encodeURIComponent(fileName)}`;
}

export function parseStorageReference(ref: string): { purpose: StoragePurpose; objectId: string; fileName: string } | null {
  if (!ref || !ref.startsWith('storage:')) return null;
  const parts = ref.split(':');
  if (parts.length < 4) return null;
  const purpose = parts[1] as StoragePurpose;
  const objectId = parts[2];
  const fileName = decodeURIComponent(parts.slice(3).join(':'));
  return { purpose, objectId, fileName };
}

export async function fetchStorageBlob(reference: string): Promise<Blob> {
  const parsed = parseStorageReference(reference);
  if (!parsed) throw new Error('Invalid storage reference.');
  return downloadStorageFile(parsed.purpose, parsed.objectId, parsed.fileName);
}

export async function openOrDownloadStorageFile(
  purpose: StoragePurpose,
  objectId: string,
  fileName: string,
  forceDownload = false,
) {
  const blob = await downloadStorageFile(purpose, objectId, fileName);
  const blobUrl = URL.createObjectURL(blob);
  
  if (!forceDownload && (blob.type.startsWith('image/') || blob.type === 'application/pdf' || blob.type.startsWith('audio/'))) {
    window.open(blobUrl, '_blank', 'noopener,noreferrer');
  } else {
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }
  
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export function getAudioExtensionFromMime(mimeType: string): string {
  const clean = mimeType.toLowerCase();
  if (clean.includes('webm')) return '.webm';
  if (clean.includes('mp4') || clean.includes('m4a') || clean.includes('aac')) return '.m4a';
  if (clean.includes('ogg') || clean.includes('opus')) return '.ogg';
  if (clean.includes('wav')) return '.wav';
  if (clean.includes('mp3') || clean.includes('mpeg')) return '.mp3';
  return '.webm';
}

/**
 * Client-side image optimization/compression using Canvas.
 * Iteratively downscales dimensions and adjusts quality in bounded steps
 * to reliably achieve <= 2 MB without infinite loops or over-degradation.
 */
export async function compressImage(
  file: File,
  targetMaxBytes = 2 * 1024 * 1024, // 2MB target
  initialMaxDimension = 1920,
): Promise<{ blob: Blob; width: number; height: number; mimeType: string }> {
  // If not an image or SVG/GIF, return as is
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml' || file.type === 'image/gif') {
    return { blob: file, width: 0, height: 0, mimeType: file.type };
  }

  // If already under targetMaxBytes and WebP, return directly
  if (file.size <= targetMaxBytes && file.type === 'image/webp') {
    return { blob: file, width: 0, height: 0, mimeType: file.type };
  }

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let curWidth = img.width;
      let curHeight = img.height;

      const attemptCompression = (dim: number, quality: number): Promise<Blob | null> => {
        return new Promise((res) => {
          let w = img.width;
          let h = img.height;
          if (w > dim || h > dim) {
            if (w > h) {
              h = Math.round((h * dim) / w);
              w = dim;
            } else {
              w = Math.round((w * dim) / h);
              h = dim;
            }
          }
          curWidth = w;
          curHeight = h;

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return res(null);

          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (blob) => res(blob),
            'image/webp',
            quality,
          );
        });
      };

      (async () => {
        const qualitySteps = [0.85, 0.75, 0.65, 0.55];
        const dimensionSteps = [initialMaxDimension, 1600, 1280, 1024];

        for (const dim of dimensionSteps) {
          for (const q of qualitySteps) {
            const resultBlob = await attemptCompression(dim, q);
            if (resultBlob && resultBlob.size <= targetMaxBytes) {
              resolve({ blob: resultBlob, width: curWidth, height: curHeight, mimeType: 'image/webp' });
              return;
            }
          }
        }

        // Final best effort with 1024px @ 0.5 quality
        const finalBlob = await attemptCompression(1024, 0.5);
        if (finalBlob && finalBlob.size < file.size) {
          resolve({ blob: finalBlob, width: curWidth, height: curHeight, mimeType: 'image/webp' });
        } else {
          resolve({ blob: file, width: img.width, height: img.height, mimeType: file.type });
        }
      })().catch(() => {
        resolve({ blob: file, width: img.width, height: img.height, mimeType: file.type });
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ blob: file, width: 0, height: 0, mimeType: file.type });
    };
    img.src = url;
  });
}
