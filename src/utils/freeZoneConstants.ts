/**
 * NTK Note Free-Zone Query & Budget Constants
 * Strictly preserves Firebase Spark ($0/month) and Cloudflare free tier quotas.
 */

export const QUICK_SHARE_LIMIT = 8;
export const GLOBAL_DIRECTORY_MIN_CHARS = 3;
export const GLOBAL_DIRECTORY_LIMIT = 8;
export const DIRECT_CHAT_LIST_LIMIT = 20;
export const DIRECT_MESSAGE_PAGE_SIZE = 40;
export const AI_THREAD_LIST_LIMIT = 20;
export const AI_TURN_PAGE_SIZE = 20;
export const AI_CONTEXT_MAX_TURNS = 6;
export const AI_CONTEXT_MAX_MESSAGES = 12; // 6 complete turns (user + assistant)
export const AI_CONTEXT_RECENT_TURNS = AI_CONTEXT_MAX_TURNS;
export const DIRECT_MESSAGE_MAX_CHARS = 4000;
export const AI_PROMPT_MAX_CHARS = 8000;
export const AI_MAX_NOTE_CONTEXT_CHARS = 10000;
export const AI_MAX_TOTAL_CONTEXT_CHARS = 28000;
export const DIRECTORY_DEBOUNCE_MS = 300;
