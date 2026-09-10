import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { AwsClient } from 'aws4fetch';
import {
  computeServerRetryBackoffMs,
  buildInitialPendingMediaState,
  canCreatePendingMediaMarker,
  advanceServerMediaRetry,
  removeUserPendingMediaCleanupMarker,
  readPendingMediaIndexFailClosed,
  readPendingReminderIndexFailClosed,
  checkStorageDeleteEligibility,
  validateReminderCleanupRequest,
  mergeReminderCleanupQueue,
  validateOrphanReminder,
  validateReminderCleanupDelete,
  filterQueuedReminderIds,
  type PendingMediaMarker,
  type PendingMediaIndexItem,
} from './queueHelpers';
import {
  classifySpeechLocale,
  buildSpeechProviderPlan,
  classifyQuotaCooldown,
  msUntilUtcMidnight,
} from './speechHelpers';

type ProviderKind = 'openrouter' | 'gemini' | 'groq' | 'mistral' | 'workers-ai' | 'cerebras' | 'freellmapi' | 'custom';
type AiTask = 'ask' | 'improve' | 'grammar' | 'professional' | 'simplify' | 'shorten' | 'expand' | 'summarize' | 'checklist' | 'actions' | 'title' | 'tags' | 'brainstorm' | 'explain' | 'continue' | 'cv';
type StorageProviderKind = 'r2' | 'backblaze' | 'supabase' | 's3';
type StoragePurpose = 'profilePhotos' | 'images' | 'voiceNotes' | 'attachments' | 'backups' | 'exports';
type HealthState = { until?: number; reason?: string };

type AiCapability = 'text' | 'tts' | 'transcription' | 'vision' | 'image';
type AiCapabilities = {
  text: boolean;
  tts: boolean;
  transcription: boolean;
  vision?: boolean;
  image?: boolean;
};

type Env = {
  NTK_CONFIG: KVNamespace;
  NTK_FILES?: R2Bucket;
  AI?: { run: (model: string, input: unknown) => Promise<unknown> };
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  OWNER_UIDS?: string;
  OWNER_EMAILS?: string;
  WORKERS_AI_MODEL?: string;
  CONFIG_ENCRYPTION_KEY: string;
};

type AuthUser = { uid: string; email?: string; anonymous: boolean; owner: boolean; payload: JWTPayload; token: string };

type ConnectionGroup = {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

type AiConnection = {
  id: string;
  name: string;
  provider: ProviderKind;
  groupId?: string;
  enabled: boolean;
  apiKey?: string;
  secretFingerprint?: string;
  baseUrl?: string;
  modelMode: 'automatic' | 'manual';
  model?: string;
  priority: number;
  capabilities?: AiCapabilities;
  notes?: string;
  lastTestOk?: boolean;
  lastTestedAt?: string;
  lastTestMessage?: string;
  createdAt: string;
  updatedAt: string;
};

type StorageConnection = {
  id: string;
  name: string;
  provider: StorageProviderKind;
  groupId?: string;
  enabled: boolean;
  endpoint?: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  secretFingerprint?: string;
  publicBaseUrl?: string;
  useWorkerBinding?: boolean;
  allowedPurposes: StoragePurpose[];
  priority: number;
  notes?: string;
  lastTestOk?: boolean;
  lastTestedAt?: string;
  lastTestMessage?: string;
  createdAt: string;
  updatedAt: string;
};

type UserFileRecord = {
  id: string;
  uid: string;
  purpose: StoragePurpose;
  fileName: string;
  size: number;
  mimeType: string;
  storageKey: string;
  connectionId: string;
  noteId?: string;
  uploaderUid?: string;
  createdAt: string;
};

type Policy = {
  guestAIEnabled: boolean;
  dailyUserLimit: number;
  totalTimeoutMs: number;
  attemptTimeoutMs: number;
  routingMode: 'automatic' | 'manual';
  connectionOrder: string[];
  respectGroupPriority: boolean;
  costProtection: boolean;
  maxOutputTokens: number;
  storageGuardEnabled?: boolean;
  storageGuardTargetGb?: number;
  b2SafetyTargetGb?: number;
  listenEngine?: {
    mode: 'automatic' | 'cloudflare' | 'google' | 'custom';
    cloudflareEnabled: boolean;
    googleEnabled: boolean;
    preferredOrder: Array<'cloudflare' | 'google'>;
  };
  messages: {
    preparing: string;
    rerouting: string;
    finalAttempt: string;
    unavailable: string;
    guestDisabled: string;
  };
};

type StoragePolicy = {
  routes: Record<StoragePurpose, 'automatic' | string>;
};

const PROVIDERS: Array<{ id: ProviderKind; label: string; keyRequired: boolean }> = [
  { id: 'openrouter', label: 'OpenRouter', keyRequired: true },
  { id: 'gemini', label: 'Google Gemini', keyRequired: true },
  { id: 'groq', label: 'Groq', keyRequired: true },
  { id: 'freellmapi', label: 'FreeLLMAPI / OpenAI-compatible router', keyRequired: true },
  { id: 'workers-ai', label: 'Cloudflare AI', keyRequired: false },
  { id: 'mistral', label: 'Mistral', keyRequired: true },
  { id: 'cerebras', label: 'Cerebras', keyRequired: true },
  { id: 'custom', label: 'Other compatible AI', keyRequired: true },
];

const STORAGE_PURPOSES: StoragePurpose[] = ['profilePhotos', 'images', 'voiceNotes', 'attachments', 'backups', 'exports'];
const DEFAULT_POLICY: Policy = {
  guestAIEnabled: false,
  dailyUserLimit: 25,
  totalTimeoutMs: 20_000,
  attemptTimeoutMs: 7_000,
  routingMode: 'automatic',
  connectionOrder: [],
  respectGroupPriority: false,
  costProtection: true,
  maxOutputTokens: 2048,
  storageGuardEnabled: true,
  storageGuardTargetGb: 8,
  b2SafetyTargetGb: 8,
  listenEngine: {
    mode: 'automatic',
    cloudflareEnabled: true,
    googleEnabled: true,
    preferredOrder: ['cloudflare', 'google'],
  },
  messages: {
    preparing: 'Getting your answer ready…',
    rerouting: 'Finding another available AI…',
    finalAttempt: 'This is taking longer than usual. Trying one last route…',
    unavailable: "NTK AI is unavailable right now, so I stopped trying rather than keep you waiting. Your note is unchanged. Please try again later.",
    guestDisabled: 'Sign in to use NTK AI, or ask the owner to enable AI for guests.',
  },
};
const DEFAULT_STORAGE_POLICY: StoragePolicy = {
  routes: { profilePhotos: 'automatic', images: 'automatic', voiceNotes: 'automatic', attachments: 'automatic', backups: 'automatic', exports: 'automatic' },
};

const jwks = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function splitList(value = '') { return value.split(',').map(item => item.trim()).filter(Boolean); }
function json(data: unknown, status = 200, headers: HeadersInit = {}) { return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
function dateKey() { return new Date().toISOString().slice(0, 10); }
function now() { return new Date().toISOString(); }
function cleanName(value: unknown, fallback: string) { const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80); return name || fallback; }
function cleanPathSegment(segment: string, fallback: string) {
  const cleaned = segment.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '');
  return cleaned.slice(0, 100) || fallback;
}
function safeInt(value: unknown, fallback: number, min: number, max: number) { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback; }
function isProviderKind(value: unknown): value is ProviderKind { return PROVIDERS.some(item => item.id === value); }
function isStoragePurpose(value: unknown): value is StoragePurpose { return STORAGE_PURPOSES.includes(value as StoragePurpose); }
function isStorageProvider(value: unknown): value is StorageProviderKind { return ['r2', 'backblaze', 'supabase', 's3'].includes(String(value)); }
function newId(prefix: string) { return `${prefix}_${crypto.randomUUID()}`; }

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = splitList(env.ALLOWED_ORIGINS);
  if (!origin || !allowed.includes(origin)) return {} as Record<string, string>;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'X-TTS-Gateway, X-TTS-Provider, X-TTS-Provider-Label, Content-Type, Content-Length',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

async function verifyUser(request: Request, env: Env): Promise<AuthUser> {
  const header = request.headers.get('Authorization') || '';
  let token = '';
  if (header.startsWith('Bearer ')) {
    token = header.slice(7);
  } else {
    // Check URL query token for streaming downloads or authenticated media preview
    const url = new URL(request.url);
    const queryToken = url.searchParams.get('token');
    if (queryToken) token = queryToken;
  }
  if (!token) throw new Response('Unauthorized', { status: 401 });
  const issuer = `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`;
  const { payload } = await jwtVerify(token, jwks, { issuer, audience: env.FIREBASE_PROJECT_ID });
  const uid = String(payload.sub || '');
  if (!uid) throw new Response('Unauthorized', { status: 401 });
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : undefined;
  const firebase = payload.firebase as { sign_in_provider?: string } | undefined;
  const anonymous = firebase?.sign_in_provider === 'anonymous';
  const owner = splitList(env.OWNER_UIDS).includes(uid) || (!!email && splitList(env.OWNER_EMAILS).map(item => item.toLowerCase()).includes(email));
  return { uid, email, anonymous, owner, payload, token };
}

async function encryptionKey(env: Env) {
  if (!env.CONFIG_ENCRYPTION_KEY) throw new Error('CONFIG_ENCRYPTION_KEY is not configured.');
  const bytes = Uint8Array.from(atob(env.CONFIG_ENCRYPTION_KEY), char => char.charCodeAt(0));
  if (bytes.length !== 32) throw new Error('CONFIG_ENCRYPTION_KEY must decode to 32 bytes.');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(env: Env, value: unknown) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(env);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)));
  return JSON.stringify({ v: 1, iv: btoa(String.fromCharCode(...iv)), data: btoa(String.fromCharCode(...new Uint8Array(encrypted))) });
}

async function unseal<T>(env: Env, raw: string | null): Promise<T | null> {
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { iv: string; data: string };
  const iv = Uint8Array.from(atob(parsed.iv), char => char.charCodeAt(0));
  const data = Uint8Array.from(atob(parsed.data), char => char.charCodeAt(0));
  const key = await encryptionKey(env);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return JSON.parse(decoder.decode(plain)) as T;
}

async function fingerprint(provider: string, secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${provider}\0${secret.trim()}`));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function getIndex(env: Env, key: string): Promise<string[]> {
  return (await env.NTK_CONFIG.get<string[]>(key, 'json')) || [];
}
async function putIndex(env: Env, key: string, ids: string[]) {
  await env.NTK_CONFIG.put(key, JSON.stringify([...new Set(ids)]));
}
async function addIndex(env: Env, key: string, id: string) { const ids = await getIndex(env, key); if (!ids.includes(id)) { ids.push(id); await putIndex(env, key, ids); } }
async function removeIndex(env: Env, key: string, id: string) { await putIndex(env, key, (await getIndex(env, key)).filter(item => item !== id)); }

async function getPolicy(env: Env): Promise<Policy> {
  const stored = await env.NTK_CONFIG.get<Partial<Policy> & { providerOrder?: string[] }>('policy', 'json');
  return {
    ...DEFAULT_POLICY,
    ...(stored || {}),
    messages: { ...DEFAULT_POLICY.messages, ...(stored?.messages || {}) },
    connectionOrder: Array.isArray(stored?.connectionOrder) ? stored!.connectionOrder! : [],
    respectGroupPriority: stored?.respectGroupPriority === true,
  };
}
async function putPolicy(env: Env, policy: Policy) { await env.NTK_CONFIG.put('policy', JSON.stringify(policy)); }

async function getStoragePolicy(env: Env): Promise<StoragePolicy> {
  const stored = await env.NTK_CONFIG.get<Partial<StoragePolicy>>('storage:policy', 'json');
  return { routes: { ...DEFAULT_STORAGE_POLICY.routes, ...(stored?.routes || {}) } };
}
async function putStoragePolicy(env: Env, policy: StoragePolicy) { await env.NTK_CONFIG.put('storage:policy', JSON.stringify(policy)); }

async function getAiGroup(env: Env, id: string) { return env.NTK_CONFIG.get<ConnectionGroup>(`ai-group:${id}`, 'json'); }
async function listAiGroups(env: Env) { return (await Promise.all((await getIndex(env, 'ai-group:index')).map(id => getAiGroup(env, id)))).filter((item): item is ConnectionGroup => !!item); }
async function putAiGroup(env: Env, group: ConnectionGroup) { await env.NTK_CONFIG.put(`ai-group:${group.id}`, JSON.stringify(group)); await addIndex(env, 'ai-group:index', group.id); }

async function getStorageGroup(env: Env, id: string) { return env.NTK_CONFIG.get<ConnectionGroup>(`storage-group:${id}`, 'json'); }
async function listStorageGroups(env: Env) { return (await Promise.all((await getIndex(env, 'storage-group:index')).map(id => getStorageGroup(env, id)))).filter((item): item is ConnectionGroup => !!item); }
async function putStorageGroup(env: Env, group: ConnectionGroup) { await env.NTK_CONFIG.put(`storage-group:${group.id}`, JSON.stringify(group)); await addIndex(env, 'storage-group:index', group.id); }

async function getAiConnection(env: Env, id: string) { return unseal<AiConnection>(env, await env.NTK_CONFIG.get(`ai-connection:${id}`)); }
async function listAiConnections(env: Env) { return (await Promise.all((await getIndex(env, 'ai-connection:index')).map(id => getAiConnection(env, id)))).filter((item): item is AiConnection => !!item); }
async function putAiConnection(env: Env, connection: AiConnection) { await env.NTK_CONFIG.put(`ai-connection:${connection.id}`, await seal(env, connection)); await addIndex(env, 'ai-connection:index', connection.id); }

async function getStorageConnection(env: Env, id: string) { return unseal<StorageConnection>(env, await env.NTK_CONFIG.get(`storage-connection:${id}`)); }
async function listStorageConnections(env: Env) { return (await Promise.all((await getIndex(env, 'storage-connection:index')).map(id => getStorageConnection(env, id)))).filter((item): item is StorageConnection => !!item); }
async function putStorageConnection(env: Env, connection: StorageConnection) { await env.NTK_CONFIG.put(`storage-connection:${connection.id}`, await seal(env, connection)); await addIndex(env, 'storage-connection:index', connection.id); }

async function putUserFileRecord(env: Env, record: UserFileRecord) {
  await env.NTK_CONFIG.put(`user-file:${record.uid}:${record.purpose}:${record.id}`, JSON.stringify(record));
  await env.NTK_CONFIG.put(`user-file-by-id:${record.purpose}:${record.id}`, JSON.stringify(record));
  await addIndex(env, `user-files-index:${record.uid}:${record.purpose}`, record.id);
}
async function getUserFileRecord(env: Env, uid: string, purpose: StoragePurpose, id: string): Promise<UserFileRecord | null> {
  return env.NTK_CONFIG.get<UserFileRecord>(`user-file:${uid}:${purpose}:${id}`, 'json');
}
async function getUserFileRecordById(env: Env, purpose: StoragePurpose, id: string): Promise<UserFileRecord | null> {
  return env.NTK_CONFIG.get<UserFileRecord>(`user-file-by-id:${purpose}:${id}`, 'json');
}
async function deleteUserFileRecord(env: Env, uid: string, purpose: StoragePurpose, id: string) {
  await env.NTK_CONFIG.delete(`user-file:${uid}:${purpose}:${id}`);
  await env.NTK_CONFIG.delete(`user-file-by-id:${purpose}:${id}`);
  await removeIndex(env, `user-files-index:${uid}:${purpose}`, id);
}
async function listUserFileRecords(env: Env, uid: string, purpose: StoragePurpose): Promise<UserFileRecord[]> {
  const ids = await getIndex(env, `user-files-index:${uid}:${purpose}`);
  const records = await Promise.all(ids.map(id => getUserFileRecord(env, uid, purpose, id)));
  return records.filter((item): item is UserFileRecord => !!item);
}

import { checkUploadIdempotency } from './idempotency';
export { checkUploadIdempotency };

// Controlled bounded owner-only migration to ensure existing files have direct user-file-by-id index
export async function runUserFileIndexMigrationBatch(
  env: Env,
  limit = 50,
  overrideCursor?: string
): Promise<{
  status: 'complete' | 'in_progress';
  cursor: string | null;
  recordsDiscovered: number;
  recordsAlreadyIndexed: number;
  recordsNewlyIndexed: number;
  isComplete: boolean;
}> {
  const currentStatus = await env.NTK_CONFIG.get('migrated:user-file-by-id:v2');
  if (currentStatus === 'complete' && !overrideCursor) {
    return {
      status: 'complete',
      cursor: null,
      recordsDiscovered: 0,
      recordsAlreadyIndexed: 0,
      recordsNewlyIndexed: 0,
      isComplete: true,
    };
  }

  const cursor = overrideCursor !== undefined
    ? (overrideCursor || undefined)
    : ((await env.NTK_CONFIG.get('migrated:user-file-by-id:v2:cursor')) || undefined);

  const boundedLimit = Math.max(1, Math.min(100, limit));
  const listRes = await env.NTK_CONFIG.list({ prefix: 'user-file:', limit: boundedLimit, cursor });

  let recordsDiscovered = 0;
  let recordsAlreadyIndexed = 0;
  let recordsNewlyIndexed = 0;

  for (const key of listRes.keys) {
    if (key.name.startsWith('user-file-by-id:') || key.name.startsWith('user-files-index:')) continue;
    recordsDiscovered++;
    const rec = await env.NTK_CONFIG.get<UserFileRecord>(key.name, 'json');
    if (rec && rec.purpose && rec.id) {
      const existing = await env.NTK_CONFIG.get(`user-file-by-id:${rec.purpose}:${rec.id}`);
      if (existing) {
        recordsAlreadyIndexed++;
      } else {
        await env.NTK_CONFIG.put(`user-file-by-id:${rec.purpose}:${rec.id}`, JSON.stringify(rec));
        recordsNewlyIndexed++;
      }
    }
  }

  if (listRes.list_complete) {
    await env.NTK_CONFIG.put('migrated:user-file-by-id:v2', 'complete');
    await env.NTK_CONFIG.delete('migrated:user-file-by-id:v2:cursor');
    return {
      status: 'complete',
      cursor: null,
      recordsDiscovered,
      recordsAlreadyIndexed,
      recordsNewlyIndexed,
      isComplete: true,
    };
  } else {
    const nextCursor = listRes.cursor || null;
    if (nextCursor) {
      await env.NTK_CONFIG.put('migrated:user-file-by-id:v2:cursor', nextCursor);
    }
    return {
      status: 'in_progress',
      cursor: nextCursor,
      recordsDiscovered,
      recordsAlreadyIndexed,
      recordsNewlyIndexed,
      isComplete: false,
    };
  }
}



// Verify legitimate read authority on shared note via authenticated Firestore REST API
async function verifySharedNoteAccess(env: Env, token: string, noteId: string): Promise<boolean> {
  if (!noteId || !token) return false;
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/shared_notes/${encodeURIComponent(noteId)}`;
    const res = await fetch(firestoreUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Strict user-media authorization helper (Sections 19-24)
// Infrastructure owners CANNOT view other users' private media/exports.
async function canUserAccessFile(
  env: Env,
  user: AuthUser,
  record: UserFileRecord,
  purpose: StoragePurpose
): Promise<boolean> {
  // 1. Owner or uploader always has access to their own files
  if (record.uid === user.uid || (record.uploaderUid && record.uploaderUid === user.uid)) {
    return true;
  }

  // 2. Profile photos are public avatars for collaborator discovery
  if (purpose === 'profilePhotos') {
    return true;
  }

  // 3. Exports and backups: strictly caller must be owner/uploader.
  // Infrastructure owner does NOT have surveillance access!
  if (purpose === 'exports' || purpose === 'backups') {
    return false;
  }

  // 4. Private files without noteId: owner/uploader only.
  if (!record.noteId) {
    return false;
  }

  // 5. For note-linked media (images, voice notes, attachments), verify caller actually has read
  // access to the shared note in Firestore using caller's Firebase token!
  return verifySharedNoteAccess(env, user.token, record.noteId);
}

// One-time backward compatibility for legacy configs
async function migrateLegacyConfig(env: Env) {
  const aiIds = await getIndex(env, 'ai-connection:index');
  if (!aiIds.length) {
    for (const provider of PROVIDERS) {
      const raw = await env.NTK_CONFIG.get(`provider:${provider.id}`);
      if (!raw) continue;
      try {
        const legacy = await unseal<{ enabled?: boolean; apiKey?: string; baseUrl?: string; modelMode?: 'automatic'|'manual'; model?: string; priority?: number; lastTestOk?: boolean; lastTestedAt?: string; lastTestMessage?: string }>(env, raw);
        if (!legacy) continue;
        const created = now();
        const id = newId('ai');
        const secretFingerprint = legacy.apiKey ? await fingerprint(provider.id, legacy.apiKey) : undefined;
        await putAiConnection(env, {
          id, name: provider.label, provider: provider.id, enabled: legacy.enabled !== false,
          apiKey: legacy.apiKey, secretFingerprint, baseUrl: legacy.baseUrl,
          modelMode: legacy.modelMode || 'automatic', model: legacy.model,
          priority: safeInt(legacy.priority, 50, 1, 100), lastTestOk: legacy.lastTestOk,
          lastTestedAt: legacy.lastTestedAt, lastTestMessage: legacy.lastTestMessage,
          createdAt: created, updatedAt: created,
        });
      } catch { /* ignore */ }
    }
  }

  const storageIds = await getIndex(env, 'storage-connection:index');
  if (!storageIds.length) {
    const raw = await env.NTK_CONFIG.get('storage');
    if (raw) {
      try {
        const legacy = await unseal<Partial<StorageConnection> & { provider?: StorageProviderKind }>(env, raw);
        if (legacy?.provider) {
          const created = now();
          const id = newId('storage');
          const secretFingerprint = legacy.secretAccessKey ? await fingerprint(legacy.provider, legacy.secretAccessKey) : undefined;
          await putStorageConnection(env, {
            id, name: `${legacy.provider.toUpperCase()} storage`, provider: legacy.provider, enabled: true,
            endpoint: legacy.endpoint, bucket: legacy.bucket, region: legacy.region, accessKeyId: legacy.accessKeyId,
            secretAccessKey: legacy.secretAccessKey, secretFingerprint, publicBaseUrl: legacy.publicBaseUrl,
            useWorkerBinding: legacy.provider === 'r2' && !legacy.endpoint,
            allowedPurposes: [...STORAGE_PURPOSES], priority: 50, lastTestOk: legacy.lastTestOk,
            lastTestedAt: legacy.lastTestedAt, lastTestMessage: legacy.lastTestMessage,
            createdAt: created, updatedAt: created,
          });
        }
      } catch { /* ignore */ }
    }
  }
}

function providerDefaults(id: ProviderKind) {
  if (id === 'openrouter') return { baseUrl: 'https://openrouter.ai/api/v1' };
  if (id === 'gemini') return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai' };
  if (id === 'groq') return { baseUrl: 'https://api.groq.com/openai/v1' };
  if (id === 'freellmapi') return { baseUrl: 'https://freellmapi.alwaysdata.net/v1' };
  if (id === 'mistral') return { baseUrl: 'https://api.mistral.ai/v1' };
  if (id === 'cerebras') return { baseUrl: 'https://api.cerebras.ai/v1' };
  return { baseUrl: '' };
}

function taskClass(task: AiTask) {
  if (['grammar', 'title', 'tags', 'shorten', 'simplify'].includes(task)) return 'fast';
  if (['professional', 'cv', 'improve', 'expand', 'continue'].includes(task)) return 'writing';
  if (['actions', 'checklist'].includes(task)) return 'structured';
  return 'general';
}

function systemPrompt(task: AiTask, style: string) {
  const base = `You are NTK AI, a helpful writing and thinking assistant inside a notes app. Be accurate, practical, concise unless detail is requested, and preserve the user's meaning. Writing style: ${style}. Return clean, readable human prose. Avoid unnecessary markdown symbols, code fences, or meta commentary unless specifically requested by the user.`;
  const taskPrompts: Record<AiTask, string> = {
    ask: 'Answer the user helpfully.', improve: 'Improve clarity, flow and readability.', grammar: 'Correct grammar, spelling and punctuation without changing meaning.', professional: 'Rewrite in a polished professional tone.', simplify: 'Rewrite in plain, easy-to-understand language.', shorten: 'Shorten while preserving the important meaning.', expand: 'Expand with useful detail; do not add unsupported facts.', summarize: 'Summarize the key points clearly.', checklist: 'Convert the content into a practical checklist.', actions: 'Extract concrete action items and owners/deadlines only if stated.', title: 'Suggest a short useful title.', tags: 'Suggest a small set of useful tags.', brainstorm: 'Generate practical, varied ideas.', explain: 'Explain clearly for a novice.', continue: 'Continue naturally without inventing factual claims.', cv: 'Improve CV/resume wording without inventing employers, dates, qualifications or achievements.'
  };
  return `${base}\nTask: ${taskPrompts[task]}`;
}

const AI_MAX_TOTAL_BUDGET_CHARS = 28000;
const AI_MAX_NOTE_CONTEXT_CHARS = 10000;
const AI_MAX_SINGLE_MESSAGE_CHARS = 4000;

function truncateSafely(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const suffix = '\n\n[…truncated for context budget…]';
  const effectiveMax = Math.max(0, maxChars - suffix.length);
  const slice = text.slice(0, effectiveMax);
  const lastParagraph = slice.lastIndexOf('\n\n');
  if (lastParagraph > effectiveMax * 0.5) {
    return slice.slice(0, lastParagraph) + suffix;
  }
  const simpleSuffix = ' […truncated…]';
  const simpleEffectiveMax = Math.max(0, maxChars - simpleSuffix.length);
  const simpleSlice = text.slice(0, simpleEffectiveMax);
  const lastSentence = Math.max(simpleSlice.lastIndexOf('. '), simpleSlice.lastIndexOf('.\n'));
  if (lastSentence > simpleEffectiveMax * 0.5) {
    return simpleSlice.slice(0, lastSentence + 1) + simpleSuffix;
  }
  return text.slice(0, Math.max(0, maxChars - 1)) + '…';
}

function buildMessages(body: Record<string, unknown>) {
  const task = String(body.task || 'ask') as AiTask;
  const style = String(body.writingStyle || 'natural');
  const title = body.noteTitle ? String(body.noteTitle).slice(0, 200) : undefined;
  const rawContext = body.noteContext ? String(body.noteContext) : undefined;

  let baseSystem = systemPrompt(task, style);
  if (title || rawContext) {
    const cappedContext = rawContext ? truncateSafely(rawContext, AI_MAX_NOTE_CONTEXT_CHARS) : '';
    baseSystem += `\n\nActive Note Context:\n${title ? `Title: ${title}\n` : ''}${cappedContext ? `Content:\n${cappedContext}` : ''}`;
  }

  // Ensure baseSystem itself leaves room for conversation
  if (baseSystem.length > AI_MAX_TOTAL_BUDGET_CHARS - 2000) {
    baseSystem = truncateSafely(baseSystem, AI_MAX_TOTAL_BUDGET_CHARS - 2000);
  }

  let remainingBudget = AI_MAX_TOTAL_BUDGET_CHARS - baseSystem.length;

  if (Array.isArray(body.messages) && body.messages.length > 0) {
    const rawMessages = body.messages as Array<{ role?: string; content?: string }>;
    // Maximum 12 messages (6 turns)
    const candidates = rawMessages.slice(-12).map(m => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: truncateSafely(String(m.content || ''), AI_MAX_SINGLE_MESSAGE_CHARS),
    }));

    // Retain newest messages first within remaining budget
    const chosen: Array<{ role: 'assistant' | 'user'; content: string }> = [];
    for (let i = candidates.length - 1; i >= 0; i--) {
      const msg = candidates[i];
      if (remainingBudget - msg.content.length < 0 && chosen.length > 0) {
        break; // Budget full, keep newest
      }
      chosen.unshift(msg);
      remainingBudget -= msg.content.length;
    }

    // Always ensure at least the newest message is present
    if (chosen.length === 0 && candidates.length > 0) {
      const last = candidates[candidates.length - 1];
      chosen.push({
        role: last.role,
        content: truncateSafely(last.content, Math.max(500, remainingBudget)),
      });
    }

    return {
      task,
      messages: [
        { role: 'system', content: baseSystem },
        ...chosen,
      ],
    };
  }

  const text = String(body.text || '');
  const instruction = body.instruction ? String(body.instruction) : undefined;
  const prompt = [
    instruction ? `User instruction: ${instruction}` : null,
    text ? `Text to work on:\n${text}` : null,
  ].filter(Boolean).join('\n\n');
  const cappedPrompt = truncateSafely(prompt, Math.max(1000, remainingBudget));

  return {
    task,
    messages: [
      { role: 'system', content: baseSystem },
      { role: 'user', content: cappedPrompt || 'Hello' },
    ],
  };
}

async function fetchModelCatalog(env: Env, connection: AiConnection): Promise<string[]> {
  const cached = await env.NTK_CONFIG.get<string[]>(`catalog:${connection.id}`, 'json');
  if (cached && cached.length) return cached;
  const defaults = providerDefaults(connection.provider);
  const base = (connection.baseUrl || defaults.baseUrl).replace(/\/$/, '');
  if (!base) return [];
  const headers: Record<string, string> = { Authorization: `Bearer ${connection.apiKey}` };
  if (connection.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://ntk-note.web.app'; headers['X-Title'] = 'NTK Note'; }
  const response = await fetch(`${base}/models`, { headers });
  if (!response.ok) return [];
  const payload = await response.json() as { data?: Array<{ id?: string }> };
  const models = (payload.data || []).map(item => String(item.id || '')).filter(Boolean);
  if (models.length) await env.NTK_CONFIG.put(`catalog:${connection.id}`, JSON.stringify(models), { expirationTtl: 3600 * 6 });
  return models;
}

async function discoverModel(env: Env, connection: AiConnection, task: AiTask, costProtection: boolean) {
  if (connection.modelMode === 'manual' && connection.model) return connection.model;
  if (connection.provider === 'freellmapi') return 'auto';
  if (connection.provider === 'custom' && (connection.baseUrl || '').includes('freellmapi')) return connection.model || 'auto';
  if (connection.provider === 'workers-ai') return connection.model || env.WORKERS_AI_MODEL || '@cf/meta/llama-3.3-70b-instruct';
  if (connection.provider === 'openrouter') return costProtection ? 'openrouter/free' : 'openrouter/auto';
  const catalog = await fetchModelCatalog(env, connection).catch(() => []);
  const candidates = catalog.length ? catalog : defaultCandidates(connection.provider);
  return pickCandidate(candidates, connection.provider, task);
}

function defaultCandidates(provider: ProviderKind): string[] {
  if (provider === 'freellmapi') return ['auto'];
  if (provider === 'gemini') return ['gemini-3.6-flash', 'gemini-3.7-flash', 'gemini-3.5-flash'];
  if (provider === 'groq') return ['qwen/qwen3.8-27b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'];
  if (provider === 'mistral') return ['mistral-small-latest', 'open-mistral-nemo'];
  if (provider === 'cerebras') return ['llama3.1-8b', 'llama3.1-70b'];
  return ['gpt-4o-mini'];
}

function pickCandidate(candidates: string[], provider: ProviderKind, task: AiTask) {
  if (provider === 'freellmapi') return 'auto';
  const cls = taskClass(task);
  const score = (model: string) => {
    const lower = model.toLowerCase();
    let value = 0;
    if (lower.includes('vision') || lower.includes('embedding') || lower.includes('moderation') || lower.includes('tts') || lower.includes('whisper')) return -100;
    if (provider === 'gemini') {
      if (lower.includes('2.5-flash')) return -50;
      if (lower.includes('3.6-flash')) value += 90;
      else if (lower.includes('3.7-flash')) value += 85;
      else if (lower.includes('3.5-flash')) value += 80;
      else if (lower.includes('flash')) value += 50;
    }
    if (provider === 'groq') {
      if (lower.includes('qwen3.8')) value += 90;
      else if (lower.includes('gpt-oss')) value += 85;
      else if (lower.includes('llama-3.3-70b')) value += 80;
    }
    if (cls === 'fast' && (lower.includes('flash') || lower.includes('small') || lower.includes('8b') || lower.includes('mini'))) value += 30;
    if (cls === 'writing' && (lower.includes('large') || lower.includes('70b') || lower.includes('27b') || lower.includes('pro'))) value += 25;
    return value;
  };
  return [...candidates].sort((a, b) => score(b) - score(a) || b.localeCompare(a))[0];
}

async function getCooldown(env: Env, connectionId: string): Promise<HealthState | null> {
  const data = await env.NTK_CONFIG.get<HealthState>(`health:${connectionId}`, 'json');
  return data?.until && data.until > Date.now() ? data : null;
}
async function setCooldown(env: Env, connectionId: string, ms: number, reason: string) {
  await env.NTK_CONFIG.put(`health:${connectionId}`, JSON.stringify({ until: Date.now() + ms, reason }), { expirationTtl: Math.max(60, Math.ceil(ms / 1000)) });
}

async function usageAllowed(env: Env, user: AuthUser, policy: Policy) {
  const key = `usage:${dateKey()}:${user.uid}`;
  const used = Number(await env.NTK_CONFIG.get(key) || '0');
  return used < policy.dailyUserLimit;
}
async function recordUsage(env: Env, user: AuthUser) {
  const key = `usage:${dateKey()}:${user.uid}`;
  const used = Number(await env.NTK_CONFIG.get(key) || '0');
  await env.NTK_CONFIG.put(key, String(used + 1), { expirationTtl: 172_800 });
}

function providerAffinity(provider: ProviderKind, task: AiTask) {
  const kind = taskClass(task);
  const affinity: Partial<Record<ProviderKind, number>> = {
    openrouter: 25,
    gemini: kind === 'writing' || kind === 'general' ? 24 : 16,
    groq: kind === 'fast' || kind === 'structured' ? 26 : 18,
    freellmapi: 22,
    'workers-ai': 14,
    mistral: kind === 'writing' ? 20 : 15,
    cerebras: kind === 'fast' || kind === 'general' ? 19 : 13,
    custom: 8,
  };
  return affinity[provider] || 0;
}

function orderedConnections(policy: Policy, configs: AiConnection[], groups: ConnectionGroup[], task: AiTask) {
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const usable = configs.filter(item => item.enabled && (!item.groupId || groupMap.get(item.groupId)?.enabled !== false));
  if (policy.routingMode === 'manual') {
    const explicit = policy.connectionOrder.filter(id => usable.some(connection => connection.id === id));
    const remainder = usable.filter(connection => !explicit.includes(connection.id)).sort((a, b) => a.priority - b.priority).map(connection => connection.id);
    return [...explicit, ...remainder];
  }
  return [...usable].sort((a, b) => {
    const groupA = a.groupId ? groupMap.get(a.groupId) : undefined;
    const groupB = b.groupId ? groupMap.get(b.groupId) : undefined;
    const groupScore = policy.respectGroupPriority ? (groupA?.priority || 50) - (groupB?.priority || 50) : 0;
    if (groupScore !== 0) return groupScore;
    const affinity = providerAffinity(b.provider, task) - providerAffinity(a.provider, task);
    if (affinity !== 0) return affinity;
    return a.priority - b.priority;
  }).map(connection => connection.id);
}

async function callOpenAiCompatible(connection: AiConnection, model: string, messages: Array<{ role: string; content: string }>, signal: AbortSignal, maxOutputTokens: number) {
  const defaults = providerDefaults(connection.provider);
  const base = (connection.baseUrl || defaults.baseUrl).replace(/\/$/, '');
  if (!base || !connection.apiKey) throw new Error('This connection is not fully configured.');
  const headers: Record<string, string> = { Authorization: `Bearer ${connection.apiKey}`, 'Content-Type': 'application/json' };
  if (connection.provider === 'openrouter') { headers['HTTP-Referer'] = 'https://ntk-note.web.app'; headers['X-Title'] = 'NTK Note'; }
  return fetch(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify({ model, messages, stream: true, max_tokens: maxOutputTokens }), signal });
}

async function callWorkersAi(env: Env, connection: AiConnection, model: string, messages: Array<{ role: string; content: string }>, maxOutputTokens: number) {
  if (!env.AI) throw new Error('Cloudflare AI binding is not configured.');
  const result = await env.AI.run(model, { messages, stream: true, max_tokens: maxOutputTokens });
  if (result instanceof ReadableStream) return new Response(result, { headers: { 'Content-Type': 'text/event-stream' } });
  return new Response(JSON.stringify(result), { headers: { 'Content-Type': 'application/json' } });
}

async function firstChunk(response: Response, timeoutMs: number) {
  if (!response.body) return { first: new Uint8Array(), reader: null as ReadableStreamDefaultReader<Uint8Array> | null };
  const reader = response.body.getReader();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const first = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Provider took too long to start responding.')), timeoutMs); }),
  ]);
  if (timeout) clearTimeout(timeout);
  if (first.done) return { first: new Uint8Array(), reader };
  return { first: first.value || new Uint8Array(), reader };
}

// CRITICAL PRIVACY & UX RULE: Never emit delta.reasoning, reasoning, thought, or thinking fields
async function streamProviderToClient(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  response: Response,
  initial: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array> | null,
  markStarted: () => void,
): Promise<number> {
  const contentType = response.headers.get('content-type') || '';
  let buffer = '';
  let totalEmitted = 0;
  const emitDelta = async (text: string) => {
    if (!text) return;
    markStarted();
    totalEmitted += text.length;
    await writer.write(encoder.encode(`event: delta\ndata: ${JSON.stringify({ text })}\n\n`));
  };
  const consume = async (chunk: Uint8Array) => {
    buffer += decoder.decode(chunk, { stream: true });
    if (!contentType.includes('text/event-stream')) return;
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const packet = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLines = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
      for (const raw of dataLines) {
        if (!raw || raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string; text?: string } }>; response?: string };
          // Strictly content/text only. NEVER reasoning or thought.
          const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.delta?.text ?? (typeof parsed.response === 'string' ? parsed.response : '');
          if (content) {
            await emitDelta(content);
          }
        } catch { /* ignore non-JSON SSE packets */ }
      }
      boundary = buffer.indexOf('\n\n');
    }
  };
  await consume(initial);
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      await consume(value || new Uint8Array());
    }
  } else if (!contentType.includes('text/event-stream')) {
    try {
      const payload = JSON.parse(buffer) as { choices?: Array<{ message?: { content?: string; text?: string } }>; response?: string; result?: { response?: string } };
      const content = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.message?.text ?? payload.response ?? payload.result?.response ?? '';
      if (content) {
        await emitDelta(content);
      }
    } catch { /* ignore */ }
  }
  return totalEmitted;
}

async function routeAi(request: Request, env: Env, user: AuthUser, policy: Policy, cors: HeadersInit) {
  if (user.anonymous && !policy.guestAIEnabled) return json({ code: 'GUEST_AI_DISABLED', message: policy.messages.guestDisabled }, 403, cors);
  if (!(await usageAllowed(env, user, policy))) return json({ code: 'LIMIT_REACHED', message: "NTK AI has reached today's shared allowance. It will be available again tomorrow. Your note is unchanged." }, 429, cors);
  const body = await request.json() as Record<string, unknown>;
  const { task, messages } = buildMessages(body);
  const groups = await listAiGroups(env);
  const configs = (await listAiConnections(env)).filter(item => item.enabled && item.lastTestOk === true);
  const ids = orderedConnections(policy, configs, groups, task);
  if (!ids.length) return json({ code: 'AI_NOT_CONFIGURED', message: 'NTK AI is not connected yet.' }, 503, cors);
  const cooldowns = await Promise.all(ids.map(async id => ({ id, cooldown: await getCooldown(env, id) })));
  if (cooldowns.every(item => !!item.cooldown)) {
    const next = Math.min(...cooldowns.map(item => item.cooldown?.until || Number.POSITIVE_INFINITY));
    const minutes = Number.isFinite(next) ? Math.max(1, Math.ceil((next - Date.now()) / 60_000)) : undefined;
    const message = minutes && minutes <= 60
      ? `NTK AI is taking a short break after a connection problem. Try again in about ${minutes} minute${minutes === 1 ? '' : 's'}. Your note is unchanged.`
      : policy.messages.unavailable;
    return json({ code: 'AI_TEMPORARILY_UNAVAILABLE', message, retryAt: Number.isFinite(next) ? new Date(next).toISOString() : undefined }, 503, cors);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const started = Date.now();
  const execution = (async () => {
    const writeEvent = (event: string, data: unknown) => writer.write(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    await writeEvent('status', { message: policy.messages.preparing });
    let attempt = 0;
    for (const id of ids) {
      if (Date.now() - started > policy.totalTimeoutMs) break;
      if (await getCooldown(env, id)) continue;
      const connection = configs.find(item => item.id === id)!;
      attempt += 1;
      if (attempt > 1) await writeEvent('status', { message: attempt === ids.length ? policy.messages.finalAttempt : policy.messages.rerouting });
      const controller = new AbortController();
      let responseStarted = false;
      const remaining = Math.max(1_500, policy.totalTimeoutMs - (Date.now() - started));
      const timeout = setTimeout(() => controller.abort(), Math.min(policy.attemptTimeoutMs, remaining));
      try {
        const model = await discoverModel(env, connection, task, policy.costProtection);
        const response = connection.provider === 'workers-ai'
          ? await callWorkersAi(env, connection, model, messages, policy.maxOutputTokens)
          : await callOpenAiCompatible(connection, model, messages, controller.signal, policy.maxOutputTokens);
        if (!response.ok) {
          clearTimeout(timeout);
          const retryAfter = Number(response.headers.get('retry-after') || '0');
          if (response.status === 429) await setCooldown(env, id, retryAfter > 0 ? retryAfter * 1000 : 15 * 60_000, 'allowance');
          else if (response.status === 401 || response.status === 403) await setCooldown(env, id, 60 * 60_000, 'credentials');
          else if (response.status >= 500) await setCooldown(env, id, 90_000, 'provider-error');
          continue;
        }
        const first = await firstChunk(response, Math.min(policy.attemptTimeoutMs, remaining));
        clearTimeout(timeout);
        await writeEvent('meta', { connectionId: id, connectionName: connection.name, provider: connection.provider, model, attempt });
        const emittedCount = await streamProviderToClient(writer, response, first.first, first.reader, () => { responseStarted = true; });
        if (emittedCount === 0) {
          throw new Error('Provider returned no final content.');
        }
        await recordUsage(env, user);
        await writeEvent('done', { connectionId: id, provider: connection.provider, model });
        await writer.close();
        return;
      } catch (error) {
        clearTimeout(timeout);
        await setCooldown(env, id, 60_000, error instanceof Error ? error.message.slice(0, 120) : 'failure').catch(() => undefined);
        if (responseStarted) {
          await recordUsage(env, user).catch(() => undefined);
          await writeEvent('error', { code: 'PARTIAL_RESPONSE', message: 'The response stopped early. You can keep what arrived, or try again.' });
          await writer.close();
          return;
        }
      }
    }
    await writeEvent('error', { code: 'AI_UNAVAILABLE', message: policy.messages.unavailable });
    await writer.close();
  })();
  execution.catch(async () => { try { await writer.close(); } catch { /* ignore */ } });
  return new Response(readable, { status: 200, headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', ...cors } });
}

async function testAiConnection(env: Env, connection: AiConnection) {
  try {
    const policy = await getPolicy(env);
    const model = await discoverModel(env, connection, 'grammar', policy.costProtection);
    const messages = [{ role: 'user', content: 'Reply with OK only.' }];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = connection.provider === 'workers-ai'
        ? await callWorkersAi(env, connection, model, messages, 32)
        : await callOpenAiCompatible(connection, model, messages, controller.signal, 32);
      if (!response.ok) throw new Error(`Connection returned ${response.status}.`);
      await response.body?.cancel().catch(() => undefined);
    } finally { clearTimeout(timer); }
    const capabilities = await probeCapabilities(env, connection, true);
    const updated: AiConnection = { ...connection, capabilities, lastTestOk: true, lastTestedAt: now(), lastTestMessage: 'Connection verified.', updatedAt: now() };
    await putAiConnection(env, updated);
    await env.NTK_CONFIG.delete(`health:${connection.id}`);
    return { ok: true, model, capabilities };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Connection test failed.';
    await putAiConnection(env, { ...connection, lastTestOk: false, lastTestedAt: now(), lastTestMessage: message.slice(0, 160), updatedAt: now() });
    throw new Error(message);
  }
}

async function getCachedCapabilities(env: Env, connectionId: string): Promise<AiCapabilities | null> {
  return env.NTK_CONFIG.get<AiCapabilities>(`capabilities:${connectionId}`, 'json');
}

async function putCachedCapabilities(env: Env, connectionId: string, caps: AiCapabilities) {
  await env.NTK_CONFIG.put(`capabilities:${connectionId}`, JSON.stringify(caps), { expirationTtl: 3600 * 6 });
}

async function probeCapabilities(env: Env, connection: AiConnection, force = false): Promise<AiCapabilities> {
  if (!force) {
    const cached = await getCachedCapabilities(env, connection.id);
    if (cached) return cached;
  }

  const caps: AiCapabilities = {
    text: true,
    tts: false,
    transcription: false,
  };

  const defaults = providerDefaults(connection.provider);
  const base = (connection.baseUrl || defaults.baseUrl).replace(/\/$/, '');
  if (!base || (connection.provider !== 'workers-ai' && !connection.apiKey)) {
    return caps;
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${connection.apiKey}` };
  if (connection.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://ntk-note.web.app';
    headers['X-Title'] = 'NTK Note';
  }

  // 1. Transcription capability
  if (connection.provider === 'groq') {
    caps.transcription = true;
  } else {
    try {
      const catalog = await fetchModelCatalog(env, connection).catch(() => []);
      if (catalog.some(m => m.toLowerCase().includes('whisper') || m.toLowerCase().includes('transcrib'))) {
        caps.transcription = true;
      } else {
        const probeRes = await fetch(`${base}/audio/transcriptions`, { method: 'HEAD', headers }).catch(() => null);
        if (probeRes && probeRes.status !== 404 && probeRes.status !== 405) {
          caps.transcription = true;
        }
      }
    } catch { /* ignore */ }
  }

  // 2. TTS capability
  if (connection.provider === 'freellmapi') {
    try {
      const catalog = await fetchModelCatalog(env, connection).catch(() => []);
      if (catalog.some(m => m.toLowerCase().includes('tts') || m.toLowerCase().includes('speech'))) {
        caps.tts = true;
      } else {
        const probeRes = await fetch(`${base}/audio/speech`, { method: 'HEAD', headers }).catch(() => null);
        if (probeRes && probeRes.status !== 404 && probeRes.status !== 405) {
          caps.tts = true;
        }
      }
    } catch { /* ignore */ }
  } else if (connection.provider === 'openrouter') {
    try {
      const catalog = await fetchModelCatalog(env, connection).catch(() => []);
      if (catalog.some(m => m.toLowerCase().includes('tts') || m.toLowerCase().includes('speech') || m.toLowerCase().includes('elevenlabs'))) {
        caps.tts = true;
      }
    } catch { /* ignore */ }
  } else if (connection.provider === 'custom') {
    try {
      const probeRes = await fetch(`${base}/audio/speech`, { method: 'HEAD', headers }).catch(() => null);
      if (probeRes && probeRes.status !== 404 && probeRes.status !== 405) {
        caps.tts = true;
      }
    } catch { /* ignore */ }
  }

  await putCachedCapabilities(env, connection.id, caps);
  return caps;
}

function splitTextIntoSpeechChunks(text: string, maxLen = 180): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return [clean];

  const chunks: string[] = [];
  const sentences = clean.match(/[^.!?;\n]+[.!?;\n]+|[^.!?;\n]+$/g) || [clean];
  let current = '';

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    if ((current + ' ' + s).trim().length <= maxLen) {
      current = current ? current + ' ' + s : s;
    } else {
      if (current) chunks.push(current);
      if (s.length <= maxLen) {
        current = s;
      } else {
        const words = s.split(' ');
        current = '';
        for (const word of words) {
          if ((current + ' ' + word).trim().length <= maxLen) {
            current = current ? current + ' ' + word : word;
          } else {
            if (current) chunks.push(current);
            current = word;
          }
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [clean];
}


async function synthesizeCloudflareMeloTTS(env: Env, text: string, lang = 'en'): Promise<ArrayBuffer | null> {
  if (!env.AI || typeof env.AI.run !== 'function') return null;
  const chunks = splitTextIntoSpeechChunks(text, 500);
  const buffers: Uint8Array[] = [];

  for (const chunk of chunks) {
    const output = await env.AI.run('@cf/myshell-ai/melotts', {
      prompt: chunk,
      lang: lang || 'en',
    }) as Uint8Array | { audio?: string } | ReadableStream<Uint8Array> | ArrayBuffer | null;

    if (!output) return null;

    if (output instanceof Uint8Array) {
      buffers.push(output);
    } else if (typeof output === 'object' && 'audio' in output && typeof output.audio === 'string') {
      const binary = atob(output.audio);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      buffers.push(bytes);
    } else if (output instanceof ReadableStream) {
      const reader = output.getReader();
      const streamChunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) streamChunks.push(value);
      }
      const total = streamChunks.reduce((acc, c) => acc + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const c of streamChunks) {
        merged.set(c, offset);
        offset += c.byteLength;
      }
      buffers.push(merged);
    } else if (output instanceof ArrayBuffer) {
      buffers.push(new Uint8Array(output));
    } else {
      return null;
    }
  }

  if (!buffers.length) return null;
  const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    merged.set(b, offset);
    offset += b.byteLength;
  }
  return merged.buffer;
}

async function synthesizeGoogleSpeech(text: string, tl: string, _speed?: number): Promise<ArrayBuffer | null> {
  const chunks = splitTextIntoSpeechChunks(text, 180);
  const buffers: Uint8Array[] = [];

  for (const chunk of chunks) {
    const url = new URL('https://translate.google.com/translate_tts');
    url.searchParams.set('ie', 'UTF-8');
    url.searchParams.set('q', chunk);
    url.searchParams.set('tl', tl);
    url.searchParams.set('client', 'tw-ob');
    // Note: Playback speed is client-side only (audio.playbackRate).
    // Generated MP3 bytes must not be altered based on user playback rate (Section 6, 7).

    try {
      const res = await fetch(url.toString(), {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Referer': 'https://translate.google.com/',
        },
      });
      if (!res.ok) return null;
      buffers.push(new Uint8Array(await res.arrayBuffer()));
    } catch {
      return null;
    }
  }

  if (!buffers.length) return null;
  const totalLength = buffers.reduce((acc, b) => acc + b.byteLength, 0);
  const merged = new Uint8Array(totalLength);
  let offset = 0;
  for (const b of buffers) {
    merged.set(b, offset);
    offset += b.byteLength;
  }
  return merged.buffer;
}

async function routeAudioSpeech(request: Request, env: Env, user: AuthUser, policy: Policy, cors: HeadersInit): Promise<Response> {
  if (user.anonymous && !policy.guestAIEnabled) {
    return json({ code: 'GUEST_AI_DISABLED', message: policy.messages.guestDisabled }, 403, cors);
  }
  if (!(await usageAllowed(env, user, policy))) {
    return json({ code: 'LIMIT_REACHED', message: "NTK AI has reached today's shared allowance. It will be available again tomorrow." }, 429, cors);
  }

  const contentLength = Number(request.headers.get('content-length') || '0');
  if (contentLength > 64 * 1024) {
    return json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds 64KB limit.' }, 413, cors);
  }

  const body = await request.json() as {
    text?: string;
    voice?: string;
    speed?: number;
    format?: string;
    connectionId?: string;
    locale?: string;
    language?: string;
    allowClosestMatch?: boolean;
    preferredEngine?: 'cloudflare' | 'google' | 'automatic';
    isDiagnostic?: boolean;
  };
  const text = String(body.text || '').trim();
  if (!text) {
    return json({ message: 'No text provided to speak.' }, 400, cors);
  }
  if (text.length > 4096) {
    return json({ code: 'TTS_TEXT_TOO_LONG', message: 'Text exceeds maximum length of 4096 characters for speech synthesis.' }, 400, cors);
  }

  const rawLocale = (body.locale || body.language || '').toLowerCase().trim();
  const allowClosestMatch = body.allowClosestMatch === true;

  // Truthful Nigerian & Regional Language Classification (Section 8, 9, 15, 17)
  const localeClassification = classifySpeechLocale(rawLocale, allowClosestMatch, body.speed);
  if (localeClassification.status === 400) {
    return json({
      code: localeClassification.code,
      message: localeClassification.message,
      closestLocale: localeClassification.closestLocale,
    }, 400, cors);
  }

  const { googleTl, cloudflareLang, isHausa } = localeClassification;

  // Build provider plan enforcing server-side owner authority (Section 10, 11, 12, 13, 26)
  const planOrder = buildSpeechProviderPlan({
    policyListenEngine: policy.listenEngine,
    hasAiBinding: !!env.AI,
    isHausa,
    user: { owner: user.owner },
    clientPreferredEngine: body.preferredEngine,
    isDiagnostic: body.isDiagnostic === true,
  });

  // Execute providers in planOrder with strict loop prevention (max 1 attempt per provider)
  const attempted = new Set<string>();

  for (const provider of planOrder) {
    if (attempted.has(provider)) continue;
    attempted.add(provider);

    if (provider === 'cloudflare') {
      const cfCooldown = await getCooldown(env, 'tts:cloudflare');
      if (cfCooldown) continue; // In quota exhaustion or error cooldown

      try {
        const cfAudio = await synthesizeCloudflareMeloTTS(env, text, cloudflareLang);
        if (cfAudio && cfAudio.byteLength > 0) {
          await recordUsage(env, user);
          return new Response(cfAudio, {
            status: 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'private, no-cache',
              'X-TTS-Gateway': 'ntk-note-gateway',
              'X-TTS-Provider': 'cloudflare',
              'X-TTS-Provider-Label': 'Cloudflare Workers AI TTS',
              'X-TTS-Model': '@cf/myshell-ai/melotts',
              'X-TTS-Locale': cloudflareLang,
              ...cors,
            },
          });
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const status = (err as { status?: number }).status;
        const cooldownInfo = classifyQuotaCooldown(errMsg, status);
        await setCooldown(env, 'tts:cloudflare', cooldownInfo.cooldownMs, cooldownInfo.reason);
      }
    }

    if (provider === 'google') {
      const googleCooldown = await getCooldown(env, 'tts:google-speech');
      if (googleCooldown) continue;

      try {
        const synthesized = await synthesizeGoogleSpeech(text, googleTl);
        if (synthesized && synthesized.byteLength > 0) {
          await recordUsage(env, user);
          return new Response(synthesized, {
            status: 200,
            headers: {
              'Content-Type': 'audio/mpeg',
              'Cache-Control': 'private, no-cache',
              'X-TTS-Gateway': 'ntk-note-gateway',
              'X-TTS-Provider': 'google-speech',
              'X-TTS-Provider-Label': 'Google Speech Fallback',
              'X-TTS-Locale': googleTl,
              ...cors,
            },
          });
        }
      } catch {
        await setCooldown(env, 'tts:google-speech', 60_000, 'speech-failed');
      }
    }
  }

  return json({
    code: 'TTS_UNAVAILABLE',
    message: 'Listening is temporarily unavailable. Please try again in a few moments.',
  }, 503, cors);
}

async function routeAudioTranscription(request: Request, env: Env, user: AuthUser, policy: Policy, cors: HeadersInit): Promise<Response> {
  if (user.anonymous && !policy.guestAIEnabled) {
    return json({ code: 'GUEST_AI_DISABLED', message: policy.messages.guestDisabled }, 403, cors);
  }
  if (!(await usageAllowed(env, user, policy))) {
    return json({ code: 'LIMIT_REACHED', message: "NTK AI has reached today's shared allowance. It will be available again tomorrow." }, 429, cors);
  }

  let audioBytes: ArrayBuffer | null = null;
  let mimeType = 'audio/webm';
  let fileName = 'audio.webm';
  let language: string | undefined = undefined;

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json() as { r2Key?: string; objectId?: string; purpose?: StoragePurpose; language?: string };
    language = body.language;

    // Reject direct storage key access (RELEASE BLOCKER fix)
    if (body.r2Key) {
      return json({
        code: 'DIRECT_KEY_FORBIDDEN',
        message: 'Direct storage key access is not permitted. Provide objectId and purpose.',
      }, 400, cors);
    }

    if (body.objectId && body.purpose) {
      if (!isStoragePurpose(body.purpose)) {
        return json({ message: 'Valid storage purpose is required.' }, 400, cors);
      }

      let record = await getUserFileRecordById(env, body.purpose, body.objectId);
      if (!record) {
        record = await getUserFileRecord(env, user.uid, body.purpose, body.objectId);
      }

      if (!record) {
        return json({ code: 'NOT_FOUND', message: 'Audio record not found.' }, 404, cors);
      }

      // Security authorization check using canonical helper (Sections 19-24)
      const isAuthorized = await canUserAccessFile(env, user, record, body.purpose);
      if (!isAuthorized) {
        return json({ code: 'FORBIDDEN', message: 'You do not have permission to transcribe this audio file.' }, 403, cors);
      }

      const conn = await getStorageConnection(env, record.connectionId) || await resolveStorageConnection(env, body.purpose);
      if (!conn) return json({ message: 'Storage connection unavailable.' }, 503, cors);
      const fetched = await getObject(env, conn, record.storageKey);
      if (!fetched) return json({ message: 'Audio file not found on storage.' }, 404, cors);
      audioBytes = await new Response(fetched.body).arrayBuffer();
      mimeType = fetched.contentType || record.mimeType || 'audio/webm';
      fileName = record.fileName || 'audio.webm';
    } else {
      return json({ message: 'objectId and purpose are required for remote audio transcription.' }, 400, cors);
    }
  } else if (contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    language = (formData.get('language') as string) || undefined;
    if (!file) return json({ message: 'An audio file is required.' }, 400, cors);
    audioBytes = await file.arrayBuffer();
    mimeType = file.type || 'audio/webm';
    fileName = file.name || 'audio.webm';
  } else {
    return json({ message: 'Unsupported content type. Send JSON with objectId and purpose or multipart/form-data with file.' }, 400, cors);
  }

  // Audio MIME allowlist & file size limits
  const ALLOWED_AUDIO_MIMES = [
    'audio/webm',
    'audio/mpeg',
    'audio/mp3',
    'audio/x-mp3',
    'audio/x-mpeg',
    'audio/mp4',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/ogg',
    'audio/x-m4a',
    'audio/m4a',
    'audio/aac',
    'audio/flac',
  ];
  const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (cleanMime && !ALLOWED_AUDIO_MIMES.includes(cleanMime) && cleanMime !== 'application/octet-stream') {
    return json({
      code: 'INVALID_AUDIO_TYPE',
      message: `Audio format '${cleanMime}' is not supported. Supported formats: webm, mp3, mp4, wav, ogg, m4a, aac.`,
    }, 400, cors);
  }

  if (!audioBytes || audioBytes.byteLength === 0) {
    return json({ code: 'EMPTY_AUDIO', message: 'Empty audio data received.' }, 400, cors);
  }
  if (audioBytes.byteLength > 25 * 1024 * 1024) {
    return json({ code: 'AUDIO_TOO_LARGE', message: 'Audio file exceeds 25MB transcription limit.' }, 400, cors);
  }

  // Map Nigerian and dialect locales to Whisper base language codes
  if (language) {
    const langLower = language.toLowerCase();
    if (langLower.startsWith('en')) language = 'en';
    else if (langLower.startsWith('yo')) language = 'yo';
    else if (langLower.startsWith('ig')) language = 'ig';
    else if (langLower.startsWith('ha')) language = 'ha';
    else if (langLower.includes('-')) language = langLower.split('-')[0];
  }

  const allConnections = (await listAiConnections(env)).filter(item => item.enabled && item.lastTestOk === true);
  const eligible: Array<{ connection: AiConnection; caps: AiCapabilities }> = [];

  for (const conn of allConnections) {
    const caps = await probeCapabilities(env, conn);
    if (caps.transcription) {
      eligible.push({ connection: conn, caps });
    }
  }

  // Priority: Groq first (whisper-large-v3 fast & free), then others
  eligible.sort((a, b) => {
    if (a.connection.provider === 'groq' && b.connection.provider !== 'groq') return -1;
    if (b.connection.provider === 'groq' && a.connection.provider !== 'groq') return 1;
    return a.connection.priority - b.connection.priority;
  });

  if (!eligible.length) {
    return json({
      code: 'TRANSCRIPTION_UNAVAILABLE',
      message: 'Audio transcription is currently unavailable because no active connection supports speech-to-text.',
    }, 503, cors);
  }

  for (const { connection } of eligible) {
    const cooldown = await getCooldown(env, connection.id);
    if (cooldown) continue;

    const defaults = providerDefaults(connection.provider);
    const base = (connection.baseUrl || defaults.baseUrl).replace(/\/$/, '');
    if (!base || !connection.apiKey) continue;

    const model = connection.provider === 'groq'
      ? 'whisper-large-v3'
      : (connection.modelMode === 'manual' && connection.model ? connection.model : 'whisper-1');

    const upstreamForm = new FormData();
    upstreamForm.append('file', new Blob([audioBytes], { type: mimeType }), fileName);
    upstreamForm.append('model', model);
    upstreamForm.append('response_format', 'json');
    if (language) upstreamForm.append('language', language);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35_000);

    try {
      const response = await fetch(`${base}/audio/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.apiKey}`,
          ...(connection.provider === 'openrouter' ? { 'HTTP-Referer': 'https://ntk-note.web.app', 'X-Title': 'NTK Note' } : {}),
        },
        body: upstreamForm,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      if (!response.ok) {
        if (response.status === 429) await setCooldown(env, connection.id, 10 * 60_000, 'allowance');
        else if (response.status >= 500) await setCooldown(env, connection.id, 60_000, 'provider-error');
        continue;
      }

      const result = await response.json() as { text?: string; language?: string; duration?: number };
      await recordUsage(env, user);
      return json({
        ok: true,
        text: result.text || '',
        language: result.language,
        duration: result.duration,
        provider: connection.provider,
      }, 200, cors);
    } catch {
      clearTimeout(timeout);
      await setCooldown(env, connection.id, 60_000, 'transcription-failed');
    }
  }

  return json({
    code: 'TRANSCRIPTION_FAILED',
    message: 'Audio transcription could not be completed right now. Your audio file is safe and unchanged.',
  }, 503, cors);
}

async function uploadObject(env: Env, connection: StorageConnection, key: string, data: ArrayBuffer | Uint8Array, contentType: string) {
  if (connection.provider === 'r2' && connection.useWorkerBinding && env.NTK_FILES) {
    await env.NTK_FILES.put(key, data, { httpMetadata: { contentType } });
    return true;
  }
  if (!connection.endpoint || !connection.bucket || !connection.accessKeyId || !connection.secretAccessKey) {
    throw new Error('Storage connection is missing endpoint, bucket, or credentials.');
  }
  const client = new AwsClient({
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
    region: connection.region || 'auto',
    service: 's3',
  });
  const url = `${connection.endpoint.replace(/\/$/, '')}/${encodeURIComponent(connection.bucket)}/${key}`;
  const response = await client.fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: data as unknown as BodyInit,
  });
  if (!response.ok) throw new Error(`Storage upload returned HTTP ${response.status}.`);
  return true;
}

async function getObject(env: Env, connection: StorageConnection, key: string) {
  if (connection.provider === 'r2' && connection.useWorkerBinding && env.NTK_FILES) {
    const object = await env.NTK_FILES.get(key);
    if (!object) return null;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType || 'application/octet-stream',
      size: object.size,
    };
  }
  if (!connection.endpoint || !connection.bucket || !connection.accessKeyId || !connection.secretAccessKey) {
    throw new Error('Storage connection is missing endpoint, bucket, or credentials.');
  }
  const client = new AwsClient({
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
    region: connection.region || 'auto',
    service: 's3',
  });
  const url = `${connection.endpoint.replace(/\/$/, '')}/${encodeURIComponent(connection.bucket)}/${key}`;
  const response = await client.fetch(url, { method: 'GET' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Storage fetch returned HTTP ${response.status}.`);
  return {
    body: response.body,
    contentType: response.headers.get('content-type') || 'application/octet-stream',
    size: Number(response.headers.get('content-length') || '0'),
  };
}

async function deleteObject(env: Env, connection: StorageConnection, key: string) {
  if (connection.provider === 'r2' && connection.useWorkerBinding && env.NTK_FILES) {
    await env.NTK_FILES.delete(key);
    return true;
  }
  if (!connection.endpoint || !connection.bucket || !connection.accessKeyId || !connection.secretAccessKey) {
    throw new Error('Storage connection is missing endpoint, bucket, or credentials.');
  }
  const client = new AwsClient({
    accessKeyId: connection.accessKeyId,
    secretAccessKey: connection.secretAccessKey,
    region: connection.region || 'auto',
    service: 's3',
  });
  const url = `${connection.endpoint.replace(/\/$/, '')}/${encodeURIComponent(connection.bucket)}/${key}`;
  const response = await client.fetch(url, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error(`Storage delete returned HTTP ${response.status}.`);
  return true;
}

async function testStorage(env: Env, config: StorageConnection) {
  const testKey = `_ntk-health/${crypto.randomUUID()}.txt`;
  await uploadObject(env, config, testKey, encoder.encode('NTK Note storage verification probe'), 'text/plain');
  const readBack = await getObject(env, config, testKey);
  if (!readBack) throw new Error('Could not read back verification probe from storage.');
  await deleteObject(env, config, testKey);
  return true;
}

async function testStorageConnection(env: Env, connection: StorageConnection) {
  try {
    await testStorage(env, connection);
    const updated = { ...connection, lastTestOk: true, lastTestedAt: now(), lastTestMessage: 'Storage connection verified.', updatedAt: now() };
    await putStorageConnection(env, updated);
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storage connection test failed.';
    await putStorageConnection(env, { ...connection, lastTestOk: false, lastTestedAt: now(), lastTestMessage: message.slice(0, 160), updatedAt: now() });
    throw new Error(message);
  }
}

async function aiStatus(env: Env, policy: Policy) {
  const groups = await listAiGroups(env);
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const connections = await listAiConnections(env);
  return Promise.all(connections.map(async connection => {
    const cooldown = await getCooldown(env, connection.id);
    const groupOff = connection.groupId ? groupMap.get(connection.groupId)?.enabled === false : false;
    const workersReady = connection.provider !== 'workers-ai' || (!!env.AI && !!(connection.model || env.WORKERS_AI_MODEL));
    const keyRequired = PROVIDERS.find(item => item.id === connection.provider)?.keyRequired !== false;
    const configured = connection.enabled && !groupOff && (connection.provider === 'workers-ai' ? workersReady : (!keyRequired || !!connection.apiKey));
    const connected = configured && connection.lastTestOk === true;
    const status = !connection.enabled || groupOff ? 'off' : cooldown ? 'limited' : connected ? 'ready' : 'attention';
    const capabilities = await probeCapabilities(env, connection);
    return {
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      providerLabel: PROVIDERS.find(item => item.id === connection.provider)?.label || connection.provider,
      groupId: connection.groupId,
      enabled: connection.enabled,
      connected,
      status,
      capabilities,
      message: groupOff ? 'Its group is turned off.' : cooldown ? 'Taking a break after a connection problem.' : connected ? 'Ready' : configured ? (connection.lastTestMessage || 'Connection has not been verified yet.') : connection.enabled ? 'Needs connection details' : 'Turned off',
      priority: connection.priority,
      modelMode: connection.modelMode,
      model: connection.modelMode === 'manual' ? connection.model : undefined,
      lastTestedAt: connection.lastTestedAt,
      notes: connection.notes,
    };
  }));
}

async function storageStatus(env: Env) {
  const groups = await listStorageGroups(env);
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const connections = await listStorageConnections(env);
  return connections.map(connection => {
    const groupOff = connection.groupId ? groupMap.get(connection.groupId)?.enabled === false : false;
    const connected = connection.enabled && !groupOff && connection.lastTestOk === true;
    return {
      id: connection.id,
      name: connection.name,
      provider: connection.provider,
      groupId: connection.groupId,
      enabled: connection.enabled,
      connected,
      status: !connection.enabled || groupOff ? 'off' : connected ? 'ready' : 'attention',
      message: groupOff ? 'Its group is turned off.' : connected ? 'Ready' : (connection.lastTestMessage || 'Needs a connection check.'),
      allowedPurposes: connection.allowedPurposes,
      priority: connection.priority,
      lastTestedAt: connection.lastTestedAt,
      notes: connection.notes,
      useWorkerBinding: !!connection.useWorkerBinding,
    };
  });
}

async function resolveStorageConnection(env: Env, purpose: StoragePurpose, explicitPolicy?: StoragePolicy): Promise<StorageConnection | null> {
  const policy = explicitPolicy || (await getStoragePolicy(env));
  const groups = await listStorageGroups(env);
  const groupMap = new Map(groups.map(group => [group.id, group]));
  const eligible = (await listStorageConnections(env)).filter(connection => {
    if (!connection.enabled || connection.lastTestOk !== true || !connection.allowedPurposes.includes(purpose)) return false;
    if (connection.groupId && groupMap.get(connection.groupId)?.enabled === false) return false;
    return true;
  });
  const route = policy.routes[purpose] || 'automatic';
  if (route !== 'automatic') return eligible.find(connection => connection.id === route) || null;
  return [...eligible].sort((a, b) => {
    const groupA = a.groupId ? groupMap.get(a.groupId)?.priority || 50 : 50;
    const groupB = b.groupId ? groupMap.get(b.groupId)?.priority || 50 : 50;
    return a.priority - b.priority || groupA - groupB || a.name.localeCompare(b.name);
  })[0] || null;
}

async function storageAvailability(env: Env, policy: StoragePolicy) {
  const output: Record<StoragePurpose, boolean> = {
    profilePhotos: false,
    images: false,
    voiceNotes: false,
    attachments: false,
    backups: false,
    exports: false,
  };
  for (const purpose of STORAGE_PURPOSES) output[purpose] = !!(await resolveStorageConnection(env, purpose, policy));
  return output;
}

async function ensureUniqueAiSecret(env: Env, provider: ProviderKind, secret: string, excludeId?: string) {
  const value = await fingerprint(provider, secret);
  const duplicate = (await listAiConnections(env)).find(connection => connection.id !== excludeId && connection.provider === provider && connection.secretFingerprint === value);
  if (duplicate) throw new Error(`This key is already saved as “${duplicate.name}”.`);
  return value;
}
async function ensureUniqueStorageSecret(env: Env, provider: StorageProviderKind, secret: string, excludeId?: string) {
  const value = await fingerprint(provider, secret);
  const duplicate = (await listStorageConnections(env)).find(connection => connection.id !== excludeId && connection.provider === provider && connection.secretFingerprint === value);
  if (duplicate) throw new Error(`This storage secret is already saved as “${duplicate.name}”.`);
  return value;
}

async function deleteAiGroup(env: Env, id: string) {
  const connections = await listAiConnections(env);
  await Promise.all(connections.filter(item => item.groupId === id).map(item => putAiConnection(env, { ...item, groupId: undefined, updatedAt: now() })));
  await env.NTK_CONFIG.delete(`ai-group:${id}`);
  await removeIndex(env, 'ai-group:index', id);
}
async function deleteStorageGroup(env: Env, id: string) {
  const connections = await listStorageConnections(env);
  await Promise.all(connections.filter(item => item.groupId === id).map(item => putStorageConnection(env, { ...item, groupId: undefined, updatedAt: now() })));
  await env.NTK_CONFIG.delete(`storage-group:${id}`);
  await removeIndex(env, 'storage-group:index', id);
}

async function ensureBoundR2Connection(env: Env): Promise<void> {
  if (!env.NTK_FILES) return;
  const existing = await listStorageConnections(env);
  const hasBoundR2 = existing.some(c => c.provider === 'r2' && c.useWorkerBinding && c.enabled);
  if (hasBoundR2) return;

  const r2ConnId = 'conn_r2_main';
  const mainR2: StorageConnection = {
    id: r2ConnId,
    name: 'Main R2 Storage',
    provider: 'r2',
    useWorkerBinding: true,
    allowedPurposes: ['profilePhotos', 'images', 'voiceNotes', 'attachments', 'backups', 'exports'],
    priority: 10,
    enabled: true,
    createdAt: now(),
    updatedAt: now(),
    notes: 'Default primary Cloudflare R2 storage bound directly to NTK Note Worker.',
  };
  try {
    await testStorage(env, mainR2);
    mainR2.lastTestOk = true;
    mainR2.lastTestedAt = now();
    mainR2.lastTestMessage = 'Storage connection verified.';
  } catch (err) {
    mainR2.lastTestOk = false;
    mainR2.lastTestedAt = now();
    mainR2.lastTestMessage = err instanceof Error ? err.message : 'Storage test failed.';
  }
  await putStorageConnection(env, mainR2);
}

async function recordStorageDelta(env: Env, provider: 'r2' | 'b2', deltaBytes: number): Promise<void> {
  const key = `storage:metrics:${provider}`;
  try {
    const raw = await env.NTK_CONFIG.get(key);
    const current = Number(raw) || 0;
    const updated = Math.max(0, current + deltaBytes);
    await env.NTK_CONFIG.put(key, String(updated));
  } catch {
    // non-fatal
  }
}

async function calculateGlobalR2Usage(env: Env): Promise<{ totalBytes: number; complete: boolean; error?: string }> {
  if (!env.NTK_FILES) return { totalBytes: 0, complete: false, error: 'R2 binding unavailable' };
  let totalBytes = 0;
  let cursor: string | undefined = undefined;
  let iterations = 0;
  try {
    do {
      const listResult = await env.NTK_FILES.list({ cursor, limit: 1000 });
      for (const obj of listResult.objects) {
        totalBytes += obj.size;
      }
      cursor = listResult.truncated ? listResult.cursor : undefined;
      iterations++;
    } while (cursor && iterations < 500);

    await env.NTK_CONFIG.put('storage:metrics:r2', String(totalBytes)).catch(() => undefined);
    return { totalBytes, complete: !cursor };
  } catch (err) {
    const raw = await env.NTK_CONFIG.get('storage:metrics:r2').catch(() => null);
    if (raw !== null) {
      return { totalBytes: Number(raw) || 0, complete: true };
    }
    return { totalBytes: 0, complete: false, error: err instanceof Error ? err.message : 'R2 calculation failed' };
  }
}

async function calculateGlobalB2Usage(env: Env, connection: StorageConnection): Promise<{ totalBytes: number; complete: boolean; error?: string }> {
  if (!connection.endpoint || !connection.bucket || !connection.accessKeyId || !connection.secretAccessKey) {
    return { totalBytes: 0, complete: false, error: 'Incomplete credentials' };
  }
  try {
    const client = new AwsClient({
      accessKeyId: connection.accessKeyId,
      secretAccessKey: connection.secretAccessKey,
      region: connection.region || 'auto',
      service: 's3',
    });
    let totalBytes = 0;
    let continuationToken: string | undefined = undefined;
    let isTruncated = true;
    let iterations = 0;

    while (isTruncated && iterations < 100) {
      const tokenParam = continuationToken ? `&continuation-token=${encodeURIComponent(continuationToken)}` : '';
      const url = `${connection.endpoint.replace(/\/$/, '')}/${encodeURIComponent(connection.bucket)}?list-type=2&max-keys=1000${tokenParam}`;
      const response = await client.fetch(url, { method: 'GET' });
      if (!response.ok) throw new Error(`B2 list returned HTTP ${response.status}`);
      const text = await response.text();
      const sizeMatches = text.matchAll(/<Size>(\d+)<\/Size>/g);
      for (const match of sizeMatches) {
        totalBytes += Number(match[1]) || 0;
      }
      const truncatedMatch = text.match(/<IsTruncated>(true|false)<\/IsTruncated>/i);
      isTruncated = truncatedMatch ? truncatedMatch[1].toLowerCase() === 'true' : false;
      const nextTokenMatch = text.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/);
      continuationToken = nextTokenMatch ? nextTokenMatch[1] : undefined;
      iterations++;
      if (!continuationToken) break;
    }
    await env.NTK_CONFIG.put('storage:metrics:b2', String(totalBytes)).catch(() => undefined);
    return { totalBytes, complete: !isTruncated };
  } catch (err) {
    const raw = await env.NTK_CONFIG.get('storage:metrics:b2').catch(() => null);
    if (raw !== null) {
      return { totalBytes: Number(raw) || 0, complete: true };
    }
    return { totalBytes: 0, complete: false, error: err instanceof Error ? err.message : 'B2 calculation failed' };
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      const user = await verifyUser(request, env);
      await migrateLegacyConfig(env);
      await ensureBoundR2Connection(env);
      const policy = await getPolicy(env);

      // System / Gateway Status
      if (url.pathname === '/v1/status' && request.method === 'GET') {
        const aiConnections = await aiStatus(env, policy);
        const aiGroups = await listAiGroups(env);
        const storageConnections = await storageStatus(env);
        const storageGroups = await listStorageGroups(env);
        const storagePolicy = await getStoragePolicy(env);
        const r2Usage = await calculateGlobalR2Usage(env);
        const b2Connection = (await listStorageConnections(env)).find(c => (c.provider === 'backblaze' || c.provider === 's3') && c.enabled && c.lastTestOk);
        const b2Usage = b2Connection ? await calculateGlobalB2Usage(env, b2Connection) : { totalBytes: 0, complete: true };
        const publicStatus = {
          connected: true,
          isOwner: user.owner,
          aiAvailable: aiConnections.some(item => item.status === 'ready'),
          guestAIEnabled: policy.guestAIEnabled,
          messages: policy.messages,
          storagePurposes: await storageAvailability(env, storagePolicy),
          storageGuardEnabled: policy.storageGuardEnabled ?? true,
          storageGuardTargetGb: policy.storageGuardTargetGb || 8,
          speechEngine: {
            gateway: 'ntk-note-gateway',
            primaryProvider: env.AI ? 'cloudflare' : 'google-speech',
            primaryProviderLabel: env.AI ? 'Cloudflare Workers AI TTS' : 'Google Speech Fallback',
            fallbackProvider: 'google-speech',
            fallbackProviderLabel: 'Google Speech Fallback',
            activeMode: policy.listenEngine?.mode || 'automatic',
            ownerMode: policy.listenEngine?.mode || 'automatic',
            cloudflareEnabled: policy.listenEngine?.cloudflareEnabled !== false,
            googleEnabled: policy.listenEngine?.googleEnabled !== false,
            cloudflareAvailable: !!env.AI,
            cloudflareInCooldown: !!(await getCooldown(env, 'tts:cloudflare')),
            googleAvailable: true,
            status: 'ready',
            freeZonePlan: 'Workers Free / Spark $0',
            capabilities: {
              cloudflare: {
                provider: 'cloudflare',
                providerLabel: 'Cloudflare Workers AI TTS',
                model: '@cf/myshell-ai/melotts',
                available: !!env.AI,
                languages: [
                  { code: 'en', label: 'English', classification: 'NATIVE' },
                  { code: 'en-NG', label: 'English (Nigeria)', classification: 'CLOSEST MATCH' },
                  { code: 'ha', label: 'Hausa', classification: 'UNAVAILABLE' },
                  { code: 'yo', label: 'Yoruba', classification: 'UNAVAILABLE' },
                  { code: 'ig', label: 'Igbo', classification: 'UNAVAILABLE' },
                ],
                voiceSelection: false,
                genderSelection: false,
                speedControl: false,
                mp3: true,
                download: true,
                saveToR2: true,
                preview: true,
              },
              google: {
                provider: 'google-speech',
                providerLabel: 'Google Speech Fallback',
                available: true,
                languages: [
                  { code: 'en', label: 'English', classification: 'NATIVE' },
                  { code: 'en-NG', label: 'English (Nigeria)', classification: 'CLOSEST MATCH' },
                  { code: 'ha', label: 'Hausa', classification: 'NATIVE' },
                  { code: 'yo', label: 'Yoruba', classification: 'CLOSEST MATCH' },
                  { code: 'ig', label: 'Igbo', classification: 'CLOSEST MATCH' },
                ],
                voiceSelection: false,
                genderSelection: false,
                speedControl: false,
                playbackSpeed: true,
                mp3: true,
                download: true,
                saveToR2: true,
                preview: true,
              },
            },
          },
        };
        if (!user.owner) return json({ ...publicStatus, aiConnections: [], aiGroups: [], storageConnections: [], storageGroups: [] }, 200, cors);
        return json({
          ...publicStatus,
          dailyUserLimit: policy.dailyUserLimit,
          routingMode: policy.routingMode,
          connectionOrder: policy.connectionOrder,
          respectGroupPriority: policy.respectGroupPriority,
          costProtection: policy.costProtection,
          maxOutputTokens: policy.maxOutputTokens,
          listenEngine: policy.listenEngine || {
            mode: 'automatic',
            cloudflareEnabled: true,
            googleEnabled: true,
            preferredOrder: ['cloudflare', 'google'],
          },
          providerCatalog: PROVIDERS.map(({ id, label }) => ({ id, label })),
          aiConnections,
          aiGroups,
          storageConnections,
          storageGroups,
          storageRoutes: storagePolicy.routes,
        }, 200, cors);
      }

      // NTK AI Chat Streaming
      if (url.pathname === '/v1/ai/chat' && request.method === 'POST') return routeAi(request, env, user, policy, cors);

      // Audio Speech (TTS / "Listen")
      if (url.pathname === '/v1/audio/speech' && request.method === 'POST') return routeAudioSpeech(request, env, user, policy, cors);

      // Audio Transcriptions ("Transcribe audio")
      if (url.pathname === '/v1/audio/transcriptions' && request.method === 'POST') return routeAudioTranscription(request, env, user, policy, cors);

      // Authenticated User Storage Endpoints
      if (url.pathname === '/v1/storage/status' && request.method === 'GET') {
        const storagePolicy = await getStoragePolicy(env);
        return json({ ok: true, purposes: await storageAvailability(env, storagePolicy) }, 200, cors);
      }

      if (url.pathname === '/v1/storage/upload' && request.method === 'POST') {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const purpose = String(formData.get('purpose') || '') as StoragePurpose;
        const noteId = (formData.get('noteId') as string) || undefined;
        if (!file || !isStoragePurpose(purpose)) {
          return json({ message: 'A file and valid storage purpose are required.' }, 400, cors);
        }
        const maxSizes: Record<StoragePurpose, number> = {
          profilePhotos: 5 * 1024 * 1024,
          images: 15 * 1024 * 1024,
          voiceNotes: 25 * 1024 * 1024,
          attachments: 50 * 1024 * 1024,
          backups: 50 * 1024 * 1024,
          exports: 50 * 1024 * 1024,
        };
        if (file.size > maxSizes[purpose]) {
          const mb = Math.round(maxSizes[purpose] / (1024 * 1024));
          return json({ message: `File exceeds maximum allowed size of ${mb}MB.` }, 400, cors);
        }

        const requestedObjectId = cleanPathSegment(String(formData.get('objectId') || ''), '');
        let objectId = (requestedObjectId && requestedObjectId.startsWith('obj_')) ? requestedObjectId : '';

        // True Idempotency Check: Return existing record immediately before any quota/guard calculations
        if (objectId) {
          const idempotencyResult = await checkUploadIdempotency(env, user.uid, purpose, objectId);
          if (idempotencyResult.isIdempotent) {
            const existingRecord = idempotencyResult.record;
            return json({
              ok: true,
              objectId: existingRecord.id,
              fileName: existingRecord.fileName,
              size: existingRecord.size,
              mimeType: existingRecord.mimeType,
              purpose: existingRecord.purpose,
              path: existingRecord.storageKey,
              url: `/v1/storage/file/${existingRecord.purpose}/${existingRecord.id}/${existingRecord.fileName}`,
              createdAt: existingRecord.createdAt,
              idempotent: true,
            }, 200, cors);
          }
        }

        const connection = await resolveStorageConnection(env, purpose);
        if (!connection) {
          return json({ code: 'STORAGE_NOT_CONFIGURED', message: `No active storage connection configured for ${purpose}.` }, 503, cors);
        }

        // True Global Storage Guard Pre-Upload Check & Fail-Safe Protection
        if (policy.storageGuardEnabled ?? true) {
          const isR2 = connection.provider === 'r2';
          const usageResult = isR2 ? await calculateGlobalR2Usage(env) : await calculateGlobalB2Usage(env, connection);
          
          if (!usageResult.complete && usageResult.totalBytes === 0 && file.size > 1024 * 1024) {
            return json({
              code: 'STORAGE_GUARD_VERIFYING',
              message: 'Storage status is currently being verified. Your file is still safe on this device.',
            }, 503, cors);
          }

          const targetGb = isR2 ? (policy.storageGuardTargetGb || 8) : (policy.b2SafetyTargetGb || 8);
          const safetyTargetBytes = targetGb * 1024 * 1024 * 1024;
          if (usageResult.totalBytes + file.size > safetyTargetBytes * 0.95) {
            return json({
              code: 'STORAGE_GUARD_PAUSED',
              message: 'Storage is temporarily full. Your file is still safe on this device.',
            }, 507, cors);
          }
        }

        if (!objectId) {
          objectId = newId('obj');
        }

        const safeFileName = cleanPathSegment(file.name || 'file', 'unnamed_file');
        const storageKey = `users/${user.uid}/${purpose}/${objectId}/${safeFileName}`;
        const arrayBuffer = await file.arrayBuffer();
        const mimeType = file.type || 'application/octet-stream';

        await uploadObject(env, connection, storageKey, arrayBuffer, mimeType);
        await recordStorageDelta(env, connection.provider === 'r2' ? 'r2' : 'b2', arrayBuffer.byteLength);

        const record: UserFileRecord = {
          id: objectId,
          uid: user.uid,
          purpose,
          fileName: safeFileName,
          size: arrayBuffer.byteLength,
          mimeType,
          storageKey,
          connectionId: connection.id,
          noteId,
          uploaderUid: user.uid,
          createdAt: now(),
        };
        await putUserFileRecord(env, record);

        return json({
          ok: true,
          objectId,
          fileName: safeFileName,
          size: record.size,
          mimeType,
          purpose,
          path: storageKey,
          url: `/v1/storage/file/${purpose}/${objectId}/${safeFileName}`,
          createdAt: record.createdAt,
        }, 201, cors);
      }

      if (url.pathname === '/v1/storage/quota' && request.method === 'GET') {
        const r2Usage = await calculateGlobalR2Usage(env);
        const b2Connection = (await listStorageConnections(env)).find(c => (c.provider === 'backblaze' || c.provider === 's3') && c.enabled && c.lastTestOk);
        const b2Usage = b2Connection ? await calculateGlobalB2Usage(env, b2Connection) : { totalBytes: 0, complete: true };

        const globalR2Bytes = r2Usage.totalBytes;
        const globalB2Bytes = b2Usage.totalBytes;
        const r2TargetBytes = (policy.storageGuardTargetGb || 8) * 1024 * 1024 * 1024;
        const b2TargetBytes = (policy.b2SafetyTargetGb || 8) * 1024 * 1024 * 1024;
        const r2UsagePercentage = Math.min(100, Math.round((globalR2Bytes / r2TargetBytes) * 100));
        const b2UsagePercentage = Math.min(100, Math.round((globalB2Bytes / b2TargetBytes) * 100));

        let userTotalBytes = 0;
        const purposeBreakdown: Record<StoragePurpose, number> = {
          profilePhotos: 0,
          images: 0,
          voiceNotes: 0,
          attachments: 0,
          backups: 0,
          exports: 0,
        };
        for (const p of STORAGE_PURPOSES) {
          const files = await listUserFileRecords(env, user.uid, p);
          const pSize = files.reduce((acc, curr) => acc + (curr.size || 0), 0);
          purposeBreakdown[p] = pSize;
          userTotalBytes += pSize;
        }

        const maxUsage = Math.max(r2UsagePercentage, b2UsagePercentage);
        return json({
          ok: true,
          globalR2Bytes,
          globalB2Bytes,
          r2TargetBytes,
          b2TargetBytes,
          r2UsagePercentage,
          b2UsagePercentage,
          userTotalBytes,
          purposes: purposeBreakdown,
          guardEnabled: policy.storageGuardEnabled ?? true,
          guardStatus: maxUsage >= 95 ? 'critical' : maxUsage >= 85 ? 'warning' : maxUsage >= 70 ? 'attention' : 'ok',
        }, 200, cors);
      }

      if (url.pathname === '/v1/storage/list' && request.method === 'GET') {
        const purpose = url.searchParams.get('purpose') as StoragePurpose;
        if (!isStoragePurpose(purpose)) return json({ message: 'Valid storage purpose is required.' }, 400, cors);
        const records = await listUserFileRecords(env, user.uid, purpose);
        return json({ ok: true, items: records }, 200, cors);
      }

      const fileMatch = url.pathname.match(/^\/v1\/storage\/file\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (fileMatch && request.method === 'GET') {
        const purpose = fileMatch[1] as StoragePurpose;
        const objectId = fileMatch[2];
        if (!isStoragePurpose(purpose)) return json({ message: 'Invalid storage purpose.' }, 400, cors);

        let record = await getUserFileRecordById(env, purpose, objectId);
        if (!record) {
          record = await getUserFileRecord(env, user.uid, purpose, objectId);
        }

        if (!record) return json({ message: 'File not found.' }, 404, cors);

        // Security authorization check using canonical helper (Sections 19-24)
        const isAuthorized = await canUserAccessFile(env, user, record, purpose);
        if (!isAuthorized) {
          return json({ message: 'Access denied to this file.' }, 403, cors);
        }

        const connection = await getStorageConnection(env, record.connectionId) || await resolveStorageConnection(env, purpose);
        if (!connection) return json({ message: 'Storage destination unavailable.' }, 503, cors);

        const object = await getObject(env, connection, record.storageKey);
        if (!object) return json({ message: 'File not found on storage.' }, 404, cors);

        return new Response(object.body, {
          status: 200,
          headers: {
            'Content-Type': record.mimeType || object.contentType,
            'Content-Disposition': `inline; filename="${encodeURIComponent(record.fileName)}"`,
            'Content-Length': String(record.size || object.size || 0),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=3600',
            ...cors,
          },
        });
      }

      const deleteMatch = url.pathname.match(/^\/v1\/storage\/file\/([^/]+)\/([^/]+)$/);
      if (deleteMatch && request.method === 'DELETE') {
        const purpose = deleteMatch[1] as StoragePurpose;
        const objectId = deleteMatch[2];
        if (!isStoragePurpose(purpose)) {
          // Terminal 400! Clean up server marker for this user (Sections 12, 13)
          await removeUserPendingMediaCleanupMarker(env.NTK_CONFIG, user.uid, purpose, objectId);
          return json({ message: 'Invalid storage purpose.' }, 400, cors);
        }

        // Sections 7-9: Check server backoff from canonical index (single source of truth)
        const eligibility = await checkStorageDeleteEligibility(env.NTK_CONFIG, user.uid, purpose, objectId);
        if (!eligibility.allowed) {
          if (eligibility.code === 'QUEUE_STATE_UNAVAILABLE') {
            return json({
              ok: false,
              code: 'QUEUE_STATE_UNAVAILABLE',
              message: eligibility.message,
            }, eligibility.status, cors);
          }
          return json({
            ok: false,
            code: eligibility.code,
            message: eligibility.message,
            nextEligibleAttemptAt: eligibility.nextEligibleAttemptAt,
          }, eligibility.status, cors);
        }

        const existingMarker = eligibility.existingMarker;

        let record = await getUserFileRecordById(env, purpose, objectId);
        if (!record) {
          record = await getUserFileRecord(env, user.uid, purpose, objectId);
        }

        if (record) {
          // Strict user-media authorization for deletion:
          // Caller must be genuine owner or uploader.
          // Infrastructure owners have NO BYPASS (Sections 14, 30, 47).
          // Collaborators with read access to shared notes CANNOT delete media (Section 30).
          const isAuthorized = record.uid === user.uid || (record.uploaderUid && record.uploaderUid === user.uid);
          if (!isAuthorized) {
            // Terminal 403! Caller does not own this file. Remove user's pending marker (Sections 12, 13)
            await removeUserPendingMediaCleanupMarker(env.NTK_CONFIG, user.uid, purpose, objectId);
            return json({ message: 'Access denied to delete this file.' }, 403, cors);
          }

          const connection = await getStorageConnection(env, record.connectionId) || await resolveStorageConnection(env, purpose);
          if (!connection) {
            // Transient 503! Advance server retry count and backoff (Section 9C, 10)
            const retryRes = await advanceServerMediaRetry(env.NTK_CONFIG, user.uid, purpose, objectId, existingMarker as any);
            return json({
              ok: false,
              code: 'STORAGE_UNAVAILABLE',
              message: 'Storage connection unavailable.',
              ...(retryRes.atCapacity ? { mediaCleanupPendingLocalOnly: true } : {}),
              retryStatePersisted: retryRes.retryStatePersisted,
            }, 503, cors);
          }

          try {
            await deleteObject(env, connection, record.storageKey);
          } catch (err: any) {
            const errMsg = String(err?.message || '');
            if (!errMsg.includes('404')) {
              console.error('Physical storage deletion failed:', err);
              // Transient 500! Advance server retry count and backoff (Section 9C, 10)
              const retryRes = await advanceServerMediaRetry(env.NTK_CONFIG, user.uid, purpose, objectId, existingMarker as any);
              return json({
                ok: false,
                code: 'STORAGE_DELETE_FAILED',
                message: 'The file could not be permanently removed yet. Please try again.',
                ...(retryRes.atCapacity ? { mediaCleanupPendingLocalOnly: true } : {}),
                retryStatePersisted: retryRes.retryStatePersisted,
              }, 500, cors);
            }
          }

          // ONLY after physical deletion succeeds or object is 404 absent:
          await recordStorageDelta(env, connection.provider === 'r2' ? 'r2' : 'b2', -(record.size || 0));
          await deleteUserFileRecord(env, record.uid, purpose, objectId);
        }

        // Clean up server-side pending cleanup marker for this file on success or already absent (Section 11)
        const removeRes = await removeUserPendingMediaCleanupMarker(env.NTK_CONFIG, user.uid, purpose, objectId);
        if (removeRes.indexReadFailed || !removeRes.indexUpdated) {
          return json({ ok: true, mediaCleanupPending: true }, 200, cors);
        }

        return json({ ok: true }, 200, cors);
      }

      // Server-side fallback for unresolved media cleanup operations (Sections 7-14)
      if (url.pathname === '/v1/storage/cleanup-pending') {
        const indexKey = `pending-media-cleanup-index:${user.uid}`;
        const MAX_SERVER_PENDING_CLEANUPS_PER_USER = 50;

        if (request.method === 'POST') {
          let body: {
            purpose?: StoragePurpose;
            objectId?: string;
          } = {};
          try {
            body = await request.json() as any;
          } catch {
            return json({ message: 'Invalid JSON request body.' }, 400, cors);
          }

          const purpose = body.purpose;
          const objectId = body.objectId;
          if (!purpose || !isStoragePurpose(purpose) || !objectId) {
            return json({ message: 'Valid purpose and objectId are required.' }, 400, cors);
          }

          // 1. Require legitimate owned file record before server marker (Sections 20, 21, 27)
          let record = await getUserFileRecordById(env, purpose, objectId);
          if (!record) {
            record = await getUserFileRecord(env, user.uid, purpose, objectId);
          }

          if (!record) {
            return json({ message: 'File record not found.' }, 404, cors);
          }

          // Strict ownership check: caller must be genuine owner or uploader
          // Infrastructure owner status gives NO BYPASS (Section 21, 27)
          const isAuthorized = record.uid === user.uid || (record.uploaderUid && record.uploaderUid === user.uid);
          if (!isAuthorized) {
            return json({ message: 'Access denied to this file.' }, 403, cors);
          }

          // 2. Load current index and check duplicate BEFORE writing marker (Sections 7, 8, 16, 17)
          const indexReadRes = await readPendingMediaIndexFailClosed(env.NTK_CONFIG, user.uid);
          if (!indexReadRes.ok) {
            return json({
              ok: false,
              code: 'QUEUE_STATE_UNAVAILABLE',
              message: indexReadRes.message,
            }, 503, cors);
          }
          const currentIndex = indexReadRes.items;
          const check = canCreatePendingMediaMarker(currentIndex, purpose, objectId, MAX_SERVER_PENDING_CLEANUPS_PER_USER);

          // Sections 7, 8: POST is primarily CREATE-IF-ABSENT.
          // If marker already exists, return 200 { ok: true, unchanged: true } with ZERO KV PUTS!
          if (check.isDuplicate) {
            return json({ ok: true, unchanged: true }, 200, cors);
          }

          // Capacity check before creating new marker:
          if (check.atCapacity) {
            return json({
              message: 'Pending media cleanup queue is at capacity (50 items max).',
              code: 'QUEUE_AT_CAPACITY'
            }, 429, cors);
          }

          // Server-authoritative initial state:
          const markerKey = `pending-media-cleanup:${user.uid}:${purpose}:${objectId}`;
          const itemQueuedAt = now();
          const markerValue = buildInitialPendingMediaState(user.uid, purpose, objectId, itemQueuedAt);

          currentIndex.push({
            purpose,
            objectId,
            queuedAt: itemQueuedAt,
            retryCount: 0,
            lastAttemptAt: null,
            nextEligibleAttemptAt: itemQueuedAt,
          });

          // Sections 8 & 9: INDEX-FIRST. Write canonical index FIRST!
          try {
            await env.NTK_CONFIG.put(indexKey, JSON.stringify(currentIndex));
          } catch (err) {
            console.error('Failed to put pending media cleanup index:', err);
            return json({ message: 'Failed to record cleanup state.', code: 'KV_WRITE_FAILED' }, 500, cors);
          }

          // Write secondary direct marker
          try {
            await env.NTK_CONFIG.put(markerKey, JSON.stringify(markerValue));
          } catch (err) {
            console.error('Failed to put secondary pending media cleanup marker:', err);
          }

          return json({ ok: true }, 200, cors);
        }

        if (request.method === 'GET') {
          const indexReadRes = await readPendingMediaIndexFailClosed(env.NTK_CONFIG, user.uid);
          if (!indexReadRes.ok) {
            return json({
              ok: false,
              code: 'QUEUE_STATE_UNAVAILABLE',
              message: indexReadRes.message,
            }, 503, cors);
          }
          return json({ ok: true, items: indexReadRes.items }, 200, cors);
        }

        if (request.method === 'DELETE') {
          let body: { purpose?: StoragePurpose; objectId?: string } = {};
          try {
            body = await request.json() as any;
          } catch {
            const qP = url.searchParams.get('purpose');
            const qO = url.searchParams.get('objectId');
            if (qP && qO) {
              body = { purpose: qP as StoragePurpose, objectId: qO };
            }
          }

          const purpose = body.purpose || (url.searchParams.get('purpose') as StoragePurpose);
          const objectId = body.objectId || url.searchParams.get('objectId');
          if (!purpose || !isStoragePurpose(purpose) || !objectId) {
            return json({ message: 'Valid purpose and objectId are required.' }, 400, cors);
          }

          const removeRes = await removeUserPendingMediaCleanupMarker(env.NTK_CONFIG, user.uid, purpose, objectId);
          if (removeRes.indexReadFailed) {
            return json({
              ok: false,
              code: 'QUEUE_STATE_UNAVAILABLE',
              message: 'Cleanup will retry automatically.',
            }, 503, cors);
          }
          if (!removeRes.indexUpdated) {
            return json({
              ok: false,
              code: 'CLEANUP_PENDING',
              message: 'Could not safely reconcile server queue state. Please retry later.',
            }, 503, cors);
          }
          return json({ ok: true, deleted: removeRes.wasPresent }, 200, cors);
        }
      }

      // Cross-Device Durable Reminder Cleanup Queue Endpoints (Sections 20-27)
      if (url.pathname === '/v1/storage/reminder-cleanup-pending') {
        const key = `pending-reminder-cleanup-index:${user.uid}`;
        const MAX_PENDING_REMINDERS_PER_USER = 100;

        if (request.method === 'GET') {
          const indexReadRes = await readPendingReminderIndexFailClosed(env.NTK_CONFIG, user.uid);
          if (!indexReadRes.ok) {
            return json({
              ok: false,
              code: 'QUEUE_STATE_UNAVAILABLE',
              message: indexReadRes.message,
            }, 503, cors);
          }
          return json({ ok: true, reminderIds: indexReadRes.items }, 200, cors);
        }

        if (request.method === 'POST') {
          let body: { reminderIds?: string[]; reminderId?: string } = {};
          try {
            body = await request.json() as any;
          } catch {
            return json({ message: 'Invalid JSON request body.' }, 400, cors);
          }

          const validation = validateReminderCleanupRequest(body.reminderIds ?? body.reminderId, 25);
          if (!validation.valid) {
            return json({ message: validation.message, code: validation.code }, validation.status, cors);
          }

          const cleanIds = validation.cleanIds;
          const indexReadRes = await readPendingReminderIndexFailClosed(env.NTK_CONFIG, user.uid);
          if (!indexReadRes.ok) {
            return json({
              ok: false,
              code: 'QUEUE_STATE_UNAVAILABLE',
              message: indexReadRes.message,
            }, 503, cors);
          }
          const existing = indexReadRes.items;

          // 1. Check existing queue membership FIRST (Section 21: zero writes, zero firestore calls on duplicate)
          const mergeResult = mergeReminderCleanupQueue(existing, cleanIds, MAX_PENDING_REMINDERS_PER_USER);
          if (mergeResult.unchanged) {
            // True duplicate no-op: ZERO KV PUTS, ZERO Firestore calls!
            return json({ ok: true, unchanged: true }, 200, cors);
          }

          // 2. All-or-Nothing capacity check (Section 13: 429 if > 100 with zero writes)
          if (mergeResult.atCapacity) {
            return json({
              ok: false,
              code: 'REMINDER_QUEUE_CAPACITY',
              message: `Reminder cleanup queue capacity exceeded (max ${MAX_PENDING_REMINDERS_PER_USER} items). Request cannot be stored partially.`,
            }, 429, cors);
          }

          // 3. Real Authority & Orphan Validation via Firestore REST (Sections 16, 17, 18, 19)
          for (const id of mergeResult.newIds) {
            const orphanCheck = await validateOrphanReminder(fetch, env.FIREBASE_PROJECT_ID, user.token, user.uid, id);
            if (!orphanCheck.valid) {
              return json({
                ok: false,
                code: orphanCheck.code,
                message: orphanCheck.message,
              }, orphanCheck.status, cors);
            }
          }

          // 4. Persist updated queue to KV only after all orphan validations pass
          await env.NTK_CONFIG.put(key, JSON.stringify(mergeResult.combined));
          return json({ ok: true, count: mergeResult.combined.length, addedCount: mergeResult.newIds.length }, 200, cors);
        }

        if (request.method === 'DELETE') {
          let body: { reminderIds?: string[]; reminderId?: string } = {};
          try {
            body = await request.json() as any;
          } catch {
            const q = url.searchParams.get('reminderId') || url.searchParams.get('reminderIds');
            if (q) body = { reminderIds: q.split(',') };
          }

          const validation = validateReminderCleanupRequest(body.reminderIds ?? body.reminderId, 25);
          if (!validation.valid) {
            return json({ message: validation.message, code: validation.code }, validation.status, cors);
          }

          const indexReadRes = await readPendingReminderIndexFailClosed(env.NTK_CONFIG, user.uid);
          if (!indexReadRes.ok) {
            return json({
              ok: false,
              code: 'QUEUE_STATE_UNAVAILABLE',
              message: indexReadRes.message,
            }, 503, cors);
          }
          const existing = indexReadRes.items;

          // Sections 15-18: MEMBERSHIP-FIRST. Filter against existing queue BEFORE any Firestore calls!
          const { queuedIds, unqueuedCount } = filterQueuedReminderIds(existing, validation.cleanIds);

          if (queuedIds.length === 0) {
            // ZERO queued IDs: return unchanged with ZERO Firestore calls and ZERO KV writes!
            return json({ ok: true, deleted: false, unchanged: true, remaining: existing.length, unqueuedIgnored: unqueuedCount }, 200, cors);
          }

          // Validate ONLY the genuinely queued IDs against Firestore (avoids burning Spark reads)
          for (const id of queuedIds) {
            const delCheck = await validateReminderCleanupDelete(fetch, env.FIREBASE_PROJECT_ID, user.token, user.uid, id);
            if (!delCheck.canDelete) {
              return json({
                ok: false,
                code: delCheck.code,
                message: delCheck.message,
                reminderId: id,
              }, delCheck.status, cors);
            }
          }

          const remaining = existing.filter(id => !queuedIds.includes(id));
          if (remaining.length === 0) {
            await env.NTK_CONFIG.delete(key);
          } else {
            await env.NTK_CONFIG.put(key, JSON.stringify(remaining));
          }

          return json({ ok: true, deleted: true, remaining: remaining.length, unqueuedIgnored: unqueuedCount }, 200, cors);
        }
      }

      // Owner Administration Endpoints
      if (url.pathname.startsWith('/v1/admin/')) {
        if (!user.owner) return json({ message: 'Owner access is required.' }, 403, cors);

        // Owner Controlled KV Migration Endpoint (Sections 32-36)
        if (url.pathname === '/v1/admin/migrations/user-file-index') {
          if (request.method === 'GET') {
            const status = await env.NTK_CONFIG.get('migrated:user-file-by-id:v2');
            const cursor = await env.NTK_CONFIG.get('migrated:user-file-by-id:v2:cursor');
            return json({
              ok: true,
              status: status || 'pending',
              cursor: cursor || null,
              isComplete: status === 'complete',
            }, 200, cors);
          }

          if (request.method === 'POST') {
            let body: { action?: string; limit?: number; cursor?: string } = {};
            try {
              body = await request.json() as any;
            } catch {
              // empty body is acceptable
            }

            if (body.action === 'status') {
              const status = await env.NTK_CONFIG.get('migrated:user-file-by-id:v2');
              const cursor = await env.NTK_CONFIG.get('migrated:user-file-by-id:v2:cursor');
              return json({
                ok: true,
                status: status || 'pending',
                cursor: cursor || null,
                isComplete: status === 'complete',
              }, 200, cors);
            }

            const result = await runUserFileIndexMigrationBatch(env, body.limit || 50, body.cursor);
            return json({
              ok: true,
              ...result,
            }, 200, cors);
          }
        }

        if (url.pathname === '/v1/admin/policy' && request.method === 'PATCH') {
          const updates = await request.json() as Partial<Policy>;
          const next: Policy = {
            ...policy,
            ...updates,
            guestAIEnabled: typeof updates.guestAIEnabled === 'boolean' ? updates.guestAIEnabled : policy.guestAIEnabled,
            dailyUserLimit: safeInt(updates.dailyUserLimit, policy.dailyUserLimit, 1, 500),
            totalTimeoutMs: safeInt(updates.totalTimeoutMs, policy.totalTimeoutMs, 5_000, 45_000),
            attemptTimeoutMs: safeInt(updates.attemptTimeoutMs, policy.attemptTimeoutMs, 2_500, 15_000),
            routingMode: updates.routingMode === 'manual' ? 'manual' : 'automatic',
            connectionOrder: Array.isArray(updates.connectionOrder) ? updates.connectionOrder.map(String).slice(0, 500) : policy.connectionOrder,
            respectGroupPriority: typeof updates.respectGroupPriority === 'boolean' ? updates.respectGroupPriority : policy.respectGroupPriority,
            costProtection: typeof updates.costProtection === 'boolean' ? updates.costProtection : policy.costProtection,
            maxOutputTokens: safeInt(updates.maxOutputTokens, policy.maxOutputTokens, 256, 8192),
            storageGuardEnabled: typeof updates.storageGuardEnabled === 'boolean' ? updates.storageGuardEnabled : policy.storageGuardEnabled,
            storageGuardTargetGb: safeInt(updates.storageGuardTargetGb, policy.storageGuardTargetGb || 8, 1, 50),
            b2SafetyTargetGb: safeInt(updates.b2SafetyTargetGb, policy.b2SafetyTargetGb || 8, 1, 50),
            listenEngine: updates.listenEngine ? {
              mode: updates.listenEngine.mode === 'cloudflare' || updates.listenEngine.mode === 'google' || updates.listenEngine.mode === 'custom' ? updates.listenEngine.mode : 'automatic',
              cloudflareEnabled: updates.listenEngine.cloudflareEnabled !== false,
              googleEnabled: updates.listenEngine.googleEnabled !== false,
              preferredOrder: Array.isArray(updates.listenEngine.preferredOrder) ? updates.listenEngine.preferredOrder.filter(p => p === 'cloudflare' || p === 'google') : ['cloudflare', 'google'],
            } : policy.listenEngine,
            messages: { ...policy.messages, ...(updates.messages || {}) },
          };
          await putPolicy(env, next);
          return json({ ok: true }, 200, cors);
        }

        if (url.pathname === '/v1/admin/ai-groups' && request.method === 'POST') {
          const incoming = await request.json() as Partial<ConnectionGroup>;
          const created = now();
          const group: ConnectionGroup = { id: newId('aigroup'), name: cleanName(incoming.name, 'New AI group'), enabled: incoming.enabled !== false, priority: safeInt(incoming.priority, 50, 1, 100), createdAt: created, updatedAt: created };
          await putAiGroup(env, group);
          return json({ ok: true, group }, 201, cors);
        }
        const aiGroupMatch = url.pathname.match(/^\/v1\/admin\/ai-groups\/([^/]+)$/);
        if (aiGroupMatch) {
          const id = decodeURIComponent(aiGroupMatch[1]);
          const existing = await getAiGroup(env, id);
          if (!existing) return json({ message: 'AI group not found.' }, 404, cors);
          if (request.method === 'DELETE') { await deleteAiGroup(env, id); return json({ ok: true }, 200, cors); }
          if (request.method === 'PATCH' || request.method === 'PUT') {
            const incoming = await request.json() as Partial<ConnectionGroup>;
            const next = { ...existing, name: incoming.name !== undefined ? cleanName(incoming.name, existing.name) : existing.name, enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : existing.enabled, priority: safeInt(incoming.priority, existing.priority, 1, 100), updatedAt: now() };
            await putAiGroup(env, next);
            return json({ ok: true, group: next }, 200, cors);
          }
        }

        if (url.pathname === '/v1/admin/ai-connections' && request.method === 'POST') {
          const incoming = await request.json() as Partial<AiConnection>;
          if (!isProviderKind(incoming.provider)) return json({ message: 'Choose a supported AI service.' }, 400, cors);
          const providerMeta = PROVIDERS.find(item => item.id === incoming.provider)!;
          const created = now();
          const apiKey = typeof incoming.apiKey === 'string' && incoming.apiKey.trim() ? incoming.apiKey.trim() : undefined;
          if (providerMeta.keyRequired && !apiKey) return json({ message: 'An API key is required.' }, 400, cors);
          if (incoming.provider === 'custom' && !(typeof incoming.baseUrl === 'string' && incoming.baseUrl.trim())) return json({ message: 'A compatible AI service address is required.' }, 400, cors);
          const id = newId('ai');
          const secretFingerprint = apiKey ? await ensureUniqueAiSecret(env, incoming.provider, apiKey) : undefined;
          const connection: AiConnection = {
            id, name: cleanName(incoming.name, providerMeta.label), provider: incoming.provider, groupId: typeof incoming.groupId === 'string' && incoming.groupId ? incoming.groupId : undefined,
            enabled: incoming.enabled !== false, apiKey, secretFingerprint, baseUrl: typeof incoming.baseUrl === 'string' && incoming.baseUrl.trim() ? incoming.baseUrl.trim().replace(/\/$/, '') : undefined,
            modelMode: incoming.modelMode === 'manual' ? 'manual' : 'automatic', model: typeof incoming.model === 'string' && incoming.model.trim() ? incoming.model.trim() : undefined,
            priority: safeInt(incoming.priority, 50, 1, 100), notes: typeof incoming.notes === 'string' ? incoming.notes.trim().slice(0, 500) : undefined,
            lastTestOk: false, lastTestMessage: 'Waiting for connection check.', createdAt: created, updatedAt: created,
          };
          await putAiConnection(env, connection);
          try { const tested = await testAiConnection(env, connection); return json({ ok: true, testOk: true, connectionId: id, model: tested.model }, 201, cors); }
          catch (error) { return json({ ok: true, testOk: false, connectionId: id, message: error instanceof Error ? error.message : 'Saved, but the connection test failed.' }, 201, cors); }
        }
        if (url.pathname === '/v1/admin/ai-connections/test-all' && request.method === 'POST') {
          const connections = (await listAiConnections(env)).filter(item => item.enabled);
          const results: Array<{ id: string; name: string; ok: boolean; message?: string }> = [];
          for (const connection of connections) {
            try { await testAiConnection(env, connection); results.push({ id: connection.id, name: connection.name, ok: true }); }
            catch (error) { results.push({ id: connection.id, name: connection.name, ok: false, message: error instanceof Error ? error.message : 'Connection test failed.' }); }
          }
          return json({ ok: results.every(item => item.ok), results }, 200, cors);
        }
        const aiConnectionMatch = url.pathname.match(/^\/v1\/admin\/ai-connections\/([^/]+)(\/test)?$/);
        if (aiConnectionMatch) {
          const id = decodeURIComponent(aiConnectionMatch[1]);
          const existing = await getAiConnection(env, id);
          if (!existing) return json({ message: 'AI connection not found.' }, 404, cors);
          if (aiConnectionMatch[2] === '/test' && request.method === 'POST') {
            try { return json(await testAiConnection(env, existing), 200, cors); }
            catch (error) { return json({ message: error instanceof Error ? error.message : 'Connection test failed.' }, 400, cors); }
          }
          if (request.method === 'DELETE') {
            await env.NTK_CONFIG.delete(`ai-connection:${id}`);
            await env.NTK_CONFIG.delete(`health:${id}`);
            await env.NTK_CONFIG.delete(`catalog:${id}`);
            await removeIndex(env, 'ai-connection:index', id);
            const currentPolicy = await getPolicy(env);
            if (currentPolicy.connectionOrder.includes(id)) await putPolicy(env, { ...currentPolicy, connectionOrder: currentPolicy.connectionOrder.filter(item => item !== id) });
            return json({ ok: true }, 200, cors);
          }
          if (request.method === 'PATCH' || request.method === 'PUT') {
            const incoming = await request.json() as Partial<AiConnection>;
            const provider = isProviderKind(incoming.provider) ? incoming.provider : existing.provider;
            const apiKey = typeof incoming.apiKey === 'string' && incoming.apiKey.trim() ? incoming.apiKey.trim() : existing.apiKey;
            let secretFingerprint = existing.secretFingerprint;
            if (typeof incoming.apiKey === 'string' && incoming.apiKey.trim()) secretFingerprint = await ensureUniqueAiSecret(env, provider, incoming.apiKey.trim(), id);
            const next: AiConnection = {
              ...existing,
              name: incoming.name !== undefined ? cleanName(incoming.name, existing.name) : existing.name,
              provider,
              groupId: incoming.groupId === null || incoming.groupId === '' ? undefined : (typeof incoming.groupId === 'string' ? incoming.groupId : existing.groupId),
              enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : existing.enabled,
              apiKey, secretFingerprint,
              baseUrl: incoming.baseUrl === '' ? undefined : (typeof incoming.baseUrl === 'string' && incoming.baseUrl.trim() ? incoming.baseUrl.trim().replace(/\/$/, '') : existing.baseUrl),
              modelMode: incoming.modelMode === 'manual' ? 'manual' : incoming.modelMode === 'automatic' ? 'automatic' : existing.modelMode,
              model: incoming.model === '' ? undefined : (typeof incoming.model === 'string' && incoming.model.trim() ? incoming.model.trim() : existing.model),
              priority: safeInt(incoming.priority, existing.priority, 1, 100),
              notes: typeof incoming.notes === 'string' ? incoming.notes.trim().slice(0, 500) : existing.notes,
              lastTestOk: false, lastTestMessage: incoming.enabled === false ? 'Turned off by the owner.' : 'Waiting for connection check.', updatedAt: now(),
            };
            const providerMeta = PROVIDERS.find(item => item.id === next.provider)!;
            if (next.enabled && providerMeta.keyRequired && !next.apiKey) return json({ message: 'An API key is required.' }, 400, cors);
            if (next.provider === 'custom' && !next.baseUrl) return json({ message: 'A compatible AI service address is required.' }, 400, cors);
            await putAiConnection(env, next);
            await env.NTK_CONFIG.delete(`health:${id}`);
            await env.NTK_CONFIG.delete(`catalog:${id}`);
            if (!next.enabled) return json({ ok: true, disabled: true }, 200, cors);
            try { const tested = await testAiConnection(env, next); return json({ ok: true, testOk: true, model: tested.model, capabilities: tested.capabilities }, 200, cors); }
            catch (error) { return json({ ok: true, testOk: false, message: error instanceof Error ? error.message : 'Saved, but the connection test failed.' }, 200, cors); }
          }
        }

        if (url.pathname === '/v1/admin/storage-groups' && request.method === 'POST') {
          const incoming = await request.json() as Partial<ConnectionGroup>;
          const created = now();
          const group: ConnectionGroup = { id: newId('storagegroup'), name: cleanName(incoming.name, 'New storage group'), enabled: incoming.enabled !== false, priority: safeInt(incoming.priority, 50, 1, 100), createdAt: created, updatedAt: created };
          await putStorageGroup(env, group);
          return json({ ok: true, group }, 201, cors);
        }
        const storageGroupMatch = url.pathname.match(/^\/v1\/admin\/storage-groups\/([^/]+)$/);
        if (storageGroupMatch) {
          const id = decodeURIComponent(storageGroupMatch[1]);
          const existing = await getStorageGroup(env, id);
          if (!existing) return json({ message: 'Storage group not found.' }, 404, cors);
          if (request.method === 'DELETE') { await deleteStorageGroup(env, id); return json({ ok: true }, 200, cors); }
          if (request.method === 'PATCH' || request.method === 'PUT') {
            const incoming = await request.json() as Partial<ConnectionGroup>;
            const next = { ...existing, name: incoming.name !== undefined ? cleanName(incoming.name, existing.name) : existing.name, enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : existing.enabled, priority: safeInt(incoming.priority, existing.priority, 1, 100), updatedAt: now() };
            await putStorageGroup(env, next);
            return json({ ok: true, group: next }, 200, cors);
          }
        }

        if (url.pathname === '/v1/admin/storage-connections' && request.method === 'POST') {
          const incoming = await request.json() as Partial<StorageConnection>;
          if (!isStorageProvider(incoming.provider)) return json({ message: 'Choose a supported storage service.' }, 400, cors);
          const created = now();
          const id = newId('storage');
          const secretAccessKey = typeof incoming.secretAccessKey === 'string' && incoming.secretAccessKey.trim() ? incoming.secretAccessKey.trim() : undefined;
          const secretFingerprint = secretAccessKey ? await ensureUniqueStorageSecret(env, incoming.provider, secretAccessKey) : undefined;
          const allowedPurposes = Array.isArray(incoming.allowedPurposes) ? incoming.allowedPurposes.filter(isStoragePurpose) : [...STORAGE_PURPOSES];
          if (!allowedPurposes.length) return json({ message: 'Choose at least one use for this storage connection.' }, 400, cors);
          const connection: StorageConnection = {
            id, name: cleanName(incoming.name, `${String(incoming.provider).toUpperCase()} storage`), provider: incoming.provider,
            groupId: typeof incoming.groupId === 'string' && incoming.groupId ? incoming.groupId : undefined,
            enabled: incoming.enabled !== false, endpoint: typeof incoming.endpoint === 'string' && incoming.endpoint.trim() ? incoming.endpoint.trim().replace(/\/$/, '') : undefined,
            bucket: typeof incoming.bucket === 'string' && incoming.bucket.trim() ? incoming.bucket.trim() : undefined,
            region: typeof incoming.region === 'string' && incoming.region.trim() ? incoming.region.trim() : 'auto',
            accessKeyId: typeof incoming.accessKeyId === 'string' && incoming.accessKeyId.trim() ? incoming.accessKeyId.trim() : undefined,
            secretAccessKey, secretFingerprint, publicBaseUrl: typeof incoming.publicBaseUrl === 'string' && incoming.publicBaseUrl.trim() ? incoming.publicBaseUrl.trim().replace(/\/$/, '') : undefined,
            useWorkerBinding: incoming.useWorkerBinding === true, allowedPurposes: allowedPurposes.length ? allowedPurposes : [...STORAGE_PURPOSES],
            priority: safeInt(incoming.priority, 50, 1, 100), notes: typeof incoming.notes === 'string' ? incoming.notes.trim().slice(0, 500) : undefined,
            lastTestOk: false, lastTestMessage: 'Waiting for connection check.', createdAt: created, updatedAt: created,
          };
          const usesBinding = connection.provider === 'r2' && connection.useWorkerBinding && !!env.NTK_FILES;
          if (!usesBinding && (!connection.endpoint || !connection.bucket || !connection.accessKeyId || !connection.secretAccessKey)) return json({ message: 'Complete the storage connection details first.' }, 400, cors);
          await putStorageConnection(env, connection);
          try { await testStorageConnection(env, connection); return json({ ok: true, testOk: true, connectionId: id }, 201, cors); }
          catch (error) { return json({ ok: true, testOk: false, connectionId: id, message: error instanceof Error ? error.message : 'Saved, but the storage test failed.' }, 201, cors); }
        }
        if (url.pathname === '/v1/admin/storage-connections/test-all' && request.method === 'POST') {
          const connections = (await listStorageConnections(env)).filter(item => item.enabled);
          const results: Array<{ id: string; name: string; ok: boolean; message?: string }> = [];
          for (const connection of connections) {
            try { await testStorageConnection(env, connection); results.push({ id: connection.id, name: connection.name, ok: true }); }
            catch (error) { results.push({ id: connection.id, name: connection.name, ok: false, message: error instanceof Error ? error.message : 'Storage test failed.' }); }
          }
          return json({ ok: results.every(item => item.ok), results }, 200, cors);
        }
        const storageConnectionMatch = url.pathname.match(/^\/v1\/admin\/storage-connections\/([^/]+)(\/test)?$/);
        if (storageConnectionMatch) {
          const id = decodeURIComponent(storageConnectionMatch[1]);
          const existing = await getStorageConnection(env, id);
          if (!existing) return json({ message: 'Storage connection not found.' }, 404, cors);
          if (storageConnectionMatch[2] === '/test' && request.method === 'POST') {
            try { return json(await testStorageConnection(env, existing), 200, cors); }
            catch (error) { return json({ message: error instanceof Error ? error.message : 'Storage test failed.' }, 400, cors); }
          }
          if (request.method === 'DELETE') {
            await env.NTK_CONFIG.delete(`storage-connection:${id}`);
            await removeIndex(env, 'storage-connection:index', id);
            const storagePolicy = await getStoragePolicy(env);
            let changed = false;
            const routes = { ...storagePolicy.routes };
            for (const purpose of STORAGE_PURPOSES) if (routes[purpose] === id) { routes[purpose] = 'automatic'; changed = true; }
            if (changed) await putStoragePolicy(env, { routes });
            return json({ ok: true }, 200, cors);
          }
          if (request.method === 'PATCH' || request.method === 'PUT') {
            const incoming = await request.json() as Partial<StorageConnection>;
            const provider = isStorageProvider(incoming.provider) ? incoming.provider : existing.provider;
            const secretAccessKey = typeof incoming.secretAccessKey === 'string' && incoming.secretAccessKey.trim() ? incoming.secretAccessKey.trim() : existing.secretAccessKey;
            let secretFingerprint = existing.secretFingerprint;
            if (typeof incoming.secretAccessKey === 'string' && incoming.secretAccessKey.trim()) secretFingerprint = await ensureUniqueStorageSecret(env, provider, incoming.secretAccessKey.trim(), id);
            const allowedPurposes = Array.isArray(incoming.allowedPurposes) ? incoming.allowedPurposes.filter(isStoragePurpose) : existing.allowedPurposes;
            const next: StorageConnection = {
              ...existing,
              name: incoming.name !== undefined ? cleanName(incoming.name, existing.name) : existing.name,
              provider,
              groupId: incoming.groupId === null || incoming.groupId === '' ? undefined : (typeof incoming.groupId === 'string' ? incoming.groupId : existing.groupId),
              enabled: typeof incoming.enabled === 'boolean' ? incoming.enabled : existing.enabled,
              endpoint: incoming.endpoint === '' ? undefined : (typeof incoming.endpoint === 'string' && incoming.endpoint.trim() ? incoming.endpoint.trim().replace(/\/$/, '') : existing.endpoint),
              bucket: incoming.bucket === '' ? undefined : (typeof incoming.bucket === 'string' && incoming.bucket.trim() ? incoming.bucket.trim() : existing.bucket),
              region: typeof incoming.region === 'string' && incoming.region.trim() ? incoming.region.trim() : existing.region,
              accessKeyId: typeof incoming.accessKeyId === 'string' && incoming.accessKeyId.trim() ? incoming.accessKeyId.trim() : existing.accessKeyId,
              secretAccessKey, secretFingerprint,
              publicBaseUrl: incoming.publicBaseUrl === '' ? undefined : (typeof incoming.publicBaseUrl === 'string' && incoming.publicBaseUrl.trim() ? incoming.publicBaseUrl.trim().replace(/\/$/, '') : existing.publicBaseUrl),
              useWorkerBinding: typeof incoming.useWorkerBinding === 'boolean' ? incoming.useWorkerBinding : existing.useWorkerBinding,
              allowedPurposes: Array.isArray(incoming.allowedPurposes) ? allowedPurposes : existing.allowedPurposes,
              priority: safeInt(incoming.priority, existing.priority, 1, 100),
              notes: typeof incoming.notes === 'string' ? incoming.notes.trim().slice(0, 500) : existing.notes,
              lastTestOk: false, lastTestMessage: incoming.enabled === false ? 'Turned off by the owner.' : 'Waiting for connection check.', updatedAt: now(),
            };
            if (!next.allowedPurposes.length) return json({ message: 'Choose at least one use for this storage connection.' }, 400, cors);
            const usesBinding = next.provider === 'r2' && next.useWorkerBinding && !!env.NTK_FILES;
            if (next.enabled && !usesBinding && (!next.endpoint || !next.bucket || !next.accessKeyId || !next.secretAccessKey)) return json({ message: 'Complete the storage connection details first.' }, 400, cors);
            await putStorageConnection(env, next);
            const storagePolicy = await getStoragePolicy(env);
            const routes = { ...storagePolicy.routes };
            let routesChanged = false;
            for (const purpose of STORAGE_PURPOSES) {
              if (routes[purpose] === id && (!next.enabled || !next.allowedPurposes.includes(purpose))) { routes[purpose] = 'automatic'; routesChanged = true; }
            }
            if (routesChanged) await putStoragePolicy(env, { routes });
            if (!next.enabled) return json({ ok: true, disabled: true }, 200, cors);
            try { await testStorageConnection(env, next); return json({ ok: true, testOk: true }, 200, cors); }
            catch (error) { return json({ ok: true, testOk: false, message: error instanceof Error ? error.message : 'Saved, but the storage test failed.' }, 200, cors); }
          }
        }

        if (url.pathname === '/v1/admin/storage-routes' && request.method === 'PATCH') {
          const incoming = await request.json() as { routes?: Partial<Record<StoragePurpose, string>> };
          const existing = await getStoragePolicy(env);
          const routes = { ...existing.routes };
          for (const purpose of STORAGE_PURPOSES) {
            const value = incoming.routes?.[purpose];
            if (value === undefined) continue;
            if (value === 'automatic') { routes[purpose] = 'automatic'; continue; }
            const connection = await getStorageConnection(env, value);
            if (!connection) return json({ message: `The selected ${purpose} storage connection no longer exists.` }, 400, cors);
            if (!connection.allowedPurposes.includes(purpose)) return json({ message: `${connection.name} is not enabled for this type of file.` }, 400, cors);
            routes[purpose] = value;
          }
          await putStoragePolicy(env, { routes });
          return json({ ok: true, routes }, 200, cors);
        }
      }

      return json({ message: 'Not found.' }, 404, cors);
    } catch (error) {
      if (error instanceof Response) return new Response(error.body, { status: error.status, headers: cors });
      console.error('NTK gateway error', error);
      return json({ message: 'The NTK gateway could not complete this request.' }, 500, cors);
    }
  },
};
