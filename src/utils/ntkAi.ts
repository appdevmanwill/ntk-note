import { auth } from '@/utils/firebase';
import type { SpeechProviderCapabilities, ListenEngineConfig } from '@/types';
export type { ListenEngineConfig } from '@/types';

export type AiTask =
  | 'ask' | 'improve' | 'grammar' | 'professional' | 'simplify' | 'shorten' | 'expand'
  | 'summarize' | 'checklist' | 'actions' | 'title' | 'tags' | 'brainstorm' | 'explain'
  | 'continue' | 'cv';

export type AiWritingStyle = 'natural' | 'professional' | 'simple' | 'detailed';
export type AiProviderKind = 'openrouter' | 'gemini' | 'groq' | 'mistral' | 'workers-ai' | 'cerebras' | 'freellmapi' | 'custom';
export type ConnectionStatus = 'ready' | 'limited' | 'attention' | 'off';
export type StoragePurpose = 'profilePhotos' | 'images' | 'voiceNotes' | 'attachments' | 'backups' | 'exports';
export type StorageProviderKind = 'r2' | 'backblaze' | 'supabase' | 's3';

export interface AiCapabilities {
  text: boolean;
  tts: boolean;
  transcription: boolean;
  vision?: boolean;
  image?: boolean;
}

export interface ConnectionGroupStatus {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
}

export interface AiConnectionStatus {
  id: string;
  name: string;
  provider: AiProviderKind;
  providerLabel: string;
  groupId?: string;
  enabled: boolean;
  connected: boolean;
  status: ConnectionStatus;
  capabilities?: AiCapabilities;
  message?: string;
  priority?: number;
  modelMode?: 'automatic' | 'manual';
  model?: string;
  lastTestedAt?: string;
  notes?: string;
}

export interface StorageConnectionStatus {
  id: string;
  name: string;
  provider: StorageProviderKind;
  groupId?: string;
  enabled: boolean;
  connected: boolean;
  status: Exclude<ConnectionStatus, 'limited'>;
  message?: string;
  allowedPurposes: StoragePurpose[];
  priority?: number;
  lastTestedAt?: string;
  notes?: string;
  useWorkerBinding?: boolean;
}

export interface SpeechEngineStatus {
  gateway: string;
  primaryProvider: 'cloudflare' | 'google-speech';
  primaryProviderLabel: string;
  fallbackProvider: string;
  fallbackProviderLabel: string;
  activeMode: 'automatic' | 'cloudflare' | 'google' | 'custom';
  activeEngine?: string;
  cloudflareAvailable: boolean;
  googleAvailable: boolean;
  status: string;
  freeZonePlan?: string;
  capabilities?: {
    cloudflare?: SpeechProviderCapabilities;
    google?: SpeechProviderCapabilities;
  };
}

export interface AiGatewayStatus {
  connected: boolean;
  isOwner: boolean;
  aiAvailable: boolean;
  guestAIEnabled: boolean;
  dailyUserLimit?: number;
  routingMode?: 'automatic' | 'manual';
  connectionOrder?: string[];
  respectGroupPriority?: boolean;
  costProtection?: boolean;
  maxOutputTokens?: number;
  providerCatalog?: Array<{ id: AiProviderKind; label: string }>;
  aiConnections: AiConnectionStatus[];
  aiGroups: ConnectionGroupStatus[];
  storageConnections: StorageConnectionStatus[];
  storageGroups: ConnectionGroupStatus[];
  storageRoutes?: Record<StoragePurpose, 'automatic' | string>;
  storagePurposes?: Record<StoragePurpose, boolean>;
  speechEngine?: SpeechEngineStatus;
  listenEngine?: ListenEngineConfig;
  messages?: {
    preparing?: string;
    rerouting?: string;
    finalAttempt?: string;
    unavailable?: string;
    guestDisabled?: string;
  };
}

export interface AiRequest {
  task: AiTask;
  text: string;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  noteTitle?: string;
  noteContext?: string;
  instruction?: string;
  writingStyle?: AiWritingStyle;
}

export interface AiStreamHandlers {
  onStatus?: (message: string) => void;
  onDelta?: (text: string) => void;
  onMeta?: (meta: { provider?: string; connectionId?: string; connectionName?: string; model?: string; attempt?: number }) => void;
}

const DEFAULT_MESSAGES = {
  preparing: 'Getting your answer ready…',
  rerouting: 'Finding another available AI…',
  finalAttempt: 'This is taking longer than usual. Trying one last route…',
  unavailable: "NTK AI is unavailable right now, so I stopped trying rather than keep you waiting. Your note is unchanged. Please try again later.",
  guestDisabled: 'Sign in to use NTK AI, or ask the owner to enable AI for guests.',
};
const EMPTY_STORAGE_PURPOSES: Record<StoragePurpose, boolean> = {
  profilePhotos: false,
  images: false,
  voiceNotes: false,
  attachments: false,
  backups: false,
  exports: false,
};
const DEFAULT_STORAGE_ROUTES: Record<StoragePurpose, 'automatic'> = {
  profilePhotos: 'automatic',
  images: 'automatic',
  voiceNotes: 'automatic',
  attachments: 'automatic',
  backups: 'automatic',
  exports: 'automatic',
};
const GATEWAY_OVERRIDE_KEY = 'ntk-gateway-url';

export function getGatewayUrl(): string {
  const override = typeof window !== 'undefined' ? window.localStorage.getItem(GATEWAY_OVERRIDE_KEY)?.trim() : '';
  const envUrl = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_NTK_GATEWAY_URL ? String(import.meta.env.VITE_NTK_GATEWAY_URL) : (typeof process !== 'undefined' ? process.env.VITE_NTK_GATEWAY_URL : undefined))?.trim();
  return (override || envUrl || 'https://ntk-note-gateway.ntk-note.workers.dev').replace(/\/$/, '');
}

export function setGatewayUrlOverride(url: string) {
  if (typeof window === 'undefined') return;
  const normalized = url.trim().replace(/\/$/, '');
  if (normalized) window.localStorage.setItem(GATEWAY_OVERRIDE_KEY, normalized);
  else window.localStorage.removeItem(GATEWAY_OVERRIDE_KEY);
}

async function authHeaders() {
  const user = auth.currentUser;
  if (!user) return {} as Record<string, string>;
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function gatewayRequest(path: string, init: RequestInit = {}) {
  const base = getGatewayUrl();
  if (!base) throw new Error('Connect the NTK gateway first.');
  const headers = new Headers(init.headers || {});
  const auth = await authHeaders();
  Object.entries(auth).forEach(([key, value]) => headers.set(key, value));
  const response = await fetch(`${base}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((payload as { message?: string }).message || 'The NTK gateway could not complete this request.');
  return payload as Record<string, unknown>;
}

export async function getAiGatewayStatus(): Promise<AiGatewayStatus> {
  const base = getGatewayUrl();
  if (!base) {
    return {
      connected: false, isOwner: false, aiAvailable: false, guestAIEnabled: false,
      aiConnections: [], aiGroups: [], storageConnections: [], storageGroups: [],
      storageRoutes: { ...DEFAULT_STORAGE_ROUTES }, storagePurposes: { ...EMPTY_STORAGE_PURPOSES }, messages: DEFAULT_MESSAGES,
    };
  }
  const response = await fetch(`${base}/v1/status`, { headers: { ...(await authHeaders()) } });
  if (!response.ok) throw new Error(response.status === 401 ? 'Sign in again to check NTK AI.' : 'NTK AI connection could not be checked.');
  const payload = await response.json() as Partial<AiGatewayStatus>;
  return {
    connected: true,
    isOwner: !!payload.isOwner,
    aiAvailable: !!payload.aiAvailable,
    guestAIEnabled: !!payload.guestAIEnabled,
    dailyUserLimit: payload.dailyUserLimit,
    routingMode: payload.routingMode || 'automatic',
    connectionOrder: payload.connectionOrder || [],
    respectGroupPriority: payload.respectGroupPriority === true,
    costProtection: payload.costProtection !== false,
    maxOutputTokens: payload.maxOutputTokens || 2048,
    providerCatalog: payload.providerCatalog || [],
    aiConnections: payload.aiConnections || [],
    aiGroups: payload.aiGroups || [],
    storageConnections: payload.storageConnections || [],
    storageGroups: payload.storageGroups || [],
    storageRoutes: { ...DEFAULT_STORAGE_ROUTES, ...(payload.storageRoutes || {}) },
    storagePurposes: { ...EMPTY_STORAGE_PURPOSES, ...(payload.storagePurposes || {}) },
    speechEngine: payload.speechEngine,
    listenEngine: payload.listenEngine,
    messages: { ...DEFAULT_MESSAGES, ...(payload.messages || {}) },
  };
}

export async function updateGatewayPolicy(policy: Record<string, unknown>) {
  return gatewayRequest('/v1/admin/policy', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(policy) });
}

export async function updateListenEnginePolicy(listenEngine: Partial<ListenEngineConfig>) {
  clearSessionSpeechCache();
  return gatewayRequest('/v1/admin/policy', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ listenEngine }),
  });
}

export async function createAiGroup(name: string) {
  return gatewayRequest('/v1/admin/ai-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}
export async function updateAiGroup(id: string, updates: Record<string, unknown>) {
  return gatewayRequest(`/v1/admin/ai-groups/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
}
export async function deleteAiGroup(id: string) {
  return gatewayRequest(`/v1/admin/ai-groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function createAiConnection(config: Record<string, unknown>) {
  return gatewayRequest('/v1/admin/ai-connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
}
export async function updateAiConnection(id: string, config: Record<string, unknown>) {
  return gatewayRequest(`/v1/admin/ai-connections/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
}
export async function deleteAiConnection(id: string) {
  return gatewayRequest(`/v1/admin/ai-connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function testAiConnection(id: string) {
  return gatewayRequest(`/v1/admin/ai-connections/${encodeURIComponent(id)}/test`, { method: 'POST' });
}
export async function testAllAiConnections() {
  return gatewayRequest('/v1/admin/ai-connections/test-all', { method: 'POST' });
}

export async function createStorageGroup(name: string) {
  return gatewayRequest('/v1/admin/storage-groups', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
}
export async function updateStorageGroup(id: string, updates: Record<string, unknown>) {
  return gatewayRequest(`/v1/admin/storage-groups/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) });
}
export async function deleteStorageGroup(id: string) {
  return gatewayRequest(`/v1/admin/storage-groups/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function createStorageConnection(config: Record<string, unknown>) {
  return gatewayRequest('/v1/admin/storage-connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
}
export async function updateStorageConnection(id: string, config: Record<string, unknown>) {
  return gatewayRequest(`/v1/admin/storage-connections/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
}
export async function deleteStorageConnection(id: string) {
  return gatewayRequest(`/v1/admin/storage-connections/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
export async function testStorageConnection(id: string) {
  return gatewayRequest(`/v1/admin/storage-connections/${encodeURIComponent(id)}/test`, { method: 'POST' });
}
export async function testAllStorageConnections() {
  return gatewayRequest('/v1/admin/storage-connections/test-all', { method: 'POST' });
}
export async function updateStorageRoutes(routes: Partial<Record<StoragePurpose, 'automatic' | string>>) {
  return gatewayRequest('/v1/admin/storage-routes', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ routes }) });
}

export async function requestNtkAi(
  request: AiRequest,
  handlers: AiStreamHandlers = {},
  signal?: AbortSignal,
): Promise<{ text: string; provider?: string; connectionId?: string; connectionName?: string; model?: string }> {
  const base = getGatewayUrl();
  if (!base) throw new Error('NTK AI has not been connected yet.');
  const response = await fetch(`${base}/v1/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(request),
    signal,
  });

  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => ({}));
    const code = (payload as { code?: string }).code;
    if (code === 'GUEST_AI_DISABLED') throw new Error(DEFAULT_MESSAGES.guestDisabled);
    if (code === 'LIMIT_REACHED') throw new Error((payload as { message?: string }).message || 'NTK AI is resting for now. Try again later.');
    throw new Error((payload as { message?: string }).message || DEFAULT_MESSAGES.unavailable);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let provider: string | undefined;
  let connectionId: string | undefined;
  let connectionName: string | undefined;
  let model: string | undefined;
  let streamError: Error | null = null;

  const handleEvent = (eventName: string, rawData: string) => {
    if (!rawData) return;
    let data: Record<string, unknown>;
    try { data = JSON.parse(rawData) as Record<string, unknown>; } catch { return; }
    if (eventName === 'status') {
      handlers.onStatus?.(String(data.message || DEFAULT_MESSAGES.preparing));
    } else if (eventName === 'delta') {
      const delta = String(data.text || '');
      text += delta;
      handlers.onDelta?.(delta);
    } else if (eventName === 'meta') {
      provider = typeof data.provider === 'string' ? data.provider : provider;
      connectionId = typeof data.connectionId === 'string' ? data.connectionId : connectionId;
      connectionName = typeof data.connectionName === 'string' ? data.connectionName : connectionName;
      model = typeof data.model === 'string' ? data.model : model;
      handlers.onMeta?.({ provider, connectionId, connectionName, model, attempt: typeof data.attempt === 'number' ? data.attempt : undefined });
    } else if (eventName === 'error') {
      streamError = new Error(String(data.message || DEFAULT_MESSAGES.unavailable));
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const packet = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      let eventName = 'message';
      const dataLines: string[] = [];
      packet.split('\n').forEach(line => {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      });
      handleEvent(eventName, dataLines.join('\n'));
      boundary = buffer.indexOf('\n\n');
    }
  }

  if (streamError) throw streamError;
  const cleaned = text.trim();
  if (!cleaned) throw new Error("NTK AI didn't return usable text this time. Please try again.");
  return { text: cleaned, provider, connectionId, connectionName, model };
}

// Bounded in-memory session cache for synthesized speech (Section 20, 21, 22, 23)
// True LRU with canonical serialized collision-free keys and UID account isolation. Max 30 entries.
export const sessionSpeechCache = new Map<string, Blob>();
export const MAX_SESSION_CACHE_ENTRIES = 30;

export interface InFlightSpeechEntry {
  promise: Promise<Blob>;
  fetchController: AbortController;
  subscribers: Set<AbortSignal | undefined>;
}

export const inFlightSpeechMap = new Map<string, InFlightSpeechEntry>();

let currentSpeechUserUid: string | null = null;

export function setCurrentSpeechUser(uid: string | null): void {
  if (currentSpeechUserUid !== uid) {
    clearSessionSpeechCache();
    currentSpeechUserUid = uid;
  }
}

export function getCurrentSpeechUser(): string | null {
  return currentSpeechUserUid;
}

export function clearSessionSpeechCache(): void {
  sessionSpeechCache.clear();
  for (const entry of inFlightSpeechMap.values()) {
    try {
      entry.fetchController.abort();
    } catch {
      /* ignore */
    }
  }
  inFlightSpeechMap.clear();
}

/**
 * Canonical JSON-serialized cache key (Section 11, 16, 17).
 * Uses speech:v4 namespace without speed (speed is client-side playback only).
 * Canonical serialization includes: uid, normalized text, normalized language,
 * closest-match consent, and preferred engine.
 */
export function computeSpeechCacheKey(options: {
  text: string;
  language?: string;
  speed?: number; // legacy parameter, ignored for cache identity (playback speed is client-side only)
  allowClosestMatch?: boolean;
  preferredEngine?: string;
  uid?: string | null;
  // Legacy optional properties preserved for backwards compatibility with call sites
  voice?: string;
  format?: string;
  gender?: string;
  style?: string;
}): string {
  const normText = (options.text || '').trim();
  const uid = options.uid ?? currentSpeechUserUid ?? 'anon';
  const rawLang = (options.language || 'auto').trim();
  const lowerLang = rawLang.toLowerCase();
  // Normalize legacy English labels (en-US, en-GB) to en for identical cache identity
  const lang = (lowerLang === 'en-us' || lowerLang === 'en-gb' || lowerLang === 'en_us' || lowerLang === 'en_gb') ? 'en' : rawLang;
  const closest = !!options.allowClosestMatch;
  const engine = options.preferredEngine || 'auto';

  return (
    'speech:v4:' +
    JSON.stringify({
      uid,
      text: normText,
      lang,
      closest,
      engine,
    })
  );
}

function checkAllSubscribersAborted(entry: InFlightSpeechEntry): void {
  // If there's any non-cancellable subscriber (undefined signal), keep fetch alive
  if (entry.subscribers.has(undefined)) {
    return;
  }
  // If no subscribers remain, or all remaining subscribers are aborted, abort underlying fetch
  if (entry.subscribers.size === 0 || Array.from(entry.subscribers).every((s) => s?.aborted)) {
    try {
      entry.fetchController.abort();
    } catch {
      /* ignore */
    }
  }
}

async function defaultSpeechFetch(options: any, fetchSignal: AbortSignal): Promise<Blob> {
  const base = getGatewayUrl();
  if (!base) throw new Error('NTK AI gateway is not configured.');
  const response = await fetch(`${base}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(options),
    signal: fetchSignal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error((payload as { message?: string }).message || 'Listening is temporarily unavailable.');
  }

  return await response.blob();
}

/**
 * Production Speech Deduplication Engine (Section 5, 6, 7, 8)
 * Ensures:
 * 1. Concurrent identical speech requests share a single upstream network fetch.
 * 2. In-flight map entry lifetime matches the underlying fetch, not an individual subscriber.
 * 3. An initiator aborting does not cancel or hide a request needed by other subscribers.
 * 4. All-subscriber cancellation aborts the underlying fetch.
 * 5. Temporary abort event listeners are thoroughly cleaned up.
 */
export async function executeSpeechWithDeduplication(
  options: {
    text: string;
    voice?: string;
    speed?: number;
    format?: string;
    language?: string;
    accent?: string;
    style?: string;
    gender?: string;
    allowClosestMatch?: boolean;
    preferredEngine?: 'cloudflare' | 'google' | 'automatic';
    uid?: string | null;
  },
  signal?: AbortSignal,
  customFetchFn?: (options: any, fetchSignal: AbortSignal) => Promise<Blob>
): Promise<Blob> {
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Listening needs an internet connection.');
  }

  if (signal?.aborted) {
    throw new DOMException('The operation was aborted', 'AbortError');
  }

  const cacheKey = computeSpeechCacheKey(options);

  // 1. Check completed LRU cache
  const cached = sessionSpeechCache.get(cacheKey);
  if (cached) {
    // True LRU: reinsert to refresh insertion order to newest (Section 21)
    sessionSpeechCache.delete(cacheKey);
    sessionSpeechCache.set(cacheKey, cached);
    return cached;
  }

  // 2. Check in-flight requests or create new shared entry
  let entry = inFlightSpeechMap.get(cacheKey);
  if (!entry) {
    const fetchController = new AbortController();
    const subscribers = new Set<AbortSignal | undefined>();

    const fetchFn = customFetchFn || defaultSpeechFetch;
    const requestPromise = (async (): Promise<Blob> => {
      const blob = await fetchFn(options, fetchController.signal);

      // Store in LRU cache
      if (sessionSpeechCache.size >= MAX_SESSION_CACHE_ENTRIES) {
        const oldestKey = sessionSpeechCache.keys().next().value;
        if (oldestKey) sessionSpeechCache.delete(oldestKey);
      }
      sessionSpeechCache.set(cacheKey, blob);

      return blob;
    })();

    const newEntry: InFlightSpeechEntry = {
      promise: requestPromise,
      fetchController,
      subscribers,
    };

    // SECTION 6: The in-flight map entry must remain present until the UNDERLYING
    // request settles: success, failure, or true all-subscriber cancellation.
    requestPromise
      .catch(() => {
        /* Handled by subscribers; avoids unhandled rejection when all subscribers abort */
      })
      .finally(() => {
        if (inFlightSpeechMap.get(cacheKey) === newEntry) {
          inFlightSpeechMap.delete(cacheKey);
        }
      });

    inFlightSpeechMap.set(cacheKey, newEntry);
    entry = newEntry;
  }

  // Register current subscriber
  entry.subscribers.add(signal);

  let cleanupListeners: (() => void) | undefined;

  try {
    if (signal) {
      const abortPromise = new Promise<never>((_, reject) => {
        const handleAbort = () => {
          reject(new DOMException('The operation was aborted', 'AbortError'));
        };
        signal.addEventListener('abort', handleAbort, { once: true });

        const onAbortCheck = () => {
          entry!.subscribers.delete(signal);
          checkAllSubscribersAborted(entry!);
        };
        signal.addEventListener('abort', onAbortCheck, { once: true });

        cleanupListeners = () => {
          signal.removeEventListener('abort', handleAbort);
          signal.removeEventListener('abort', onAbortCheck);
        };
      });

      return await Promise.race([entry.promise, abortPromise]);
    } else {
      return await entry.promise;
    }
  } finally {
    // SECTION 8: Clean up abort event listeners
    if (cleanupListeners) {
      cleanupListeners();
    }
    // SECTION 6: Individual consumer finally blocks only remove that consumer/subscriber.
    // They must NOT delete the shared map entry while another consumer is still using it.
    entry.subscribers.delete(signal);
    checkAllSubscribersAborted(entry);
  }
}

export async function textToSpeech(
  options: {
    text: string;
    voice?: string;
    speed?: number;
    format?: string;
    language?: string;
    accent?: string;
    style?: string;
    gender?: string;
    allowClosestMatch?: boolean;
    preferredEngine?: 'cloudflare' | 'google' | 'automatic';
  },
  signal?: AbortSignal
): Promise<Blob> {
  return executeSpeechWithDeduplication(options, signal);
}


export async function transcribeAudio(
  options: { file?: Blob | File; objectId?: string; purpose?: StoragePurpose; language?: string },
  signal?: AbortSignal
): Promise<{ text: string; language?: string; duration?: number; provider?: string }> {
  if (typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Transcription needs an internet connection. Your recording is safe.');
  }
  const base = getGatewayUrl();
  if (!base) throw new Error('NTK AI gateway is not configured.');

  let headers: HeadersInit = await authHeaders();
  let body: BodyInit;

  if (options.file) {
    const formData = new FormData();
    formData.append('file', options.file);
    if (options.language) formData.append('language', options.language);
    body = formData;
  } else if (options.objectId && options.purpose) {
    headers = { 'Content-Type': 'application/json', ...headers };
    body = JSON.stringify({
      objectId: options.objectId,
      purpose: options.purpose,
      language: options.language,
    });
  } else {
    throw new Error('No audio file or storage reference provided for transcription.');
  }

  const response = await fetch(`${base}/v1/audio/transcriptions`, {
    method: 'POST',
    headers,
    body,
    signal,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error((payload as { message?: string }).message || 'Audio transcription could not be completed.');
  }

  return response.json() as Promise<{ text: string; language?: string; duration?: number; provider?: string }>;
}
