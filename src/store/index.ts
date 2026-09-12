import { create } from 'zustand';
import { v4 as uuid } from 'uuid';
import { db } from '@/utils/firebase';
import { auth } from '@/utils/firebase';
import { collection, doc, getDoc, setDoc, deleteDoc, limit, onSnapshot, orderBy, query, waitForPendingWrites, where } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { premiumFontFamilies } from '@/utils/fonts';
import { encryptNoteData, decryptNoteData } from '@/utils/crypto';
import {
  buildDirectorySearchPrefixes,
  getEntityParticipants,
  legacyEmailsToShareAccess,
  normalizeEmail,
  normalizeShareAccess,
  shareAccessToRoleArrays,
} from '@/utils/collaboration';
import {
  listCloudBackups,
  loadCloudBackupPayload,
  removeCloudBackup,
  saveCloudBackup,
  type CloudBackupMeta,
} from '@/utils/cloudBackup';
import type {
  Note, Notebook, Tag, NoteColor, Priority,
  ChecklistItem, UserProfile, AppSettings, SidebarView,
  SearchFilters, ThemeMode, ThemeAccent, NoteTheme, Reminder, NoteTemplate, Section,
  SavedSearch, SyncConflict, SyncQueueItem, ShareAccess, TeamSpace, ActivityItem,
  AppNotification, ManualSyncResult, SyncStatus, AppReminder, ReminderStatus,
  SyncConflictStrategy, ConflictRecoveryNotice
} from '@/types';
import { calculateSnoozeTime } from '@/utils/reminders';
import { buildTemplateDraft } from '@/utils/templateExperience';
import { buildDeletionPlan, executePermanentDeletion, retryPendingReminderCleanups, type DeletionResult } from '@/utils/recycleBinService';
import { retryPendingMediaCleanups } from '@/utils/pendingMediaCleanupQueue';
import { unsubscribeActiveMessages, clearChatCache } from '@/utils/chatService';
import { setCurrentSpeechUser } from '@/utils/ntkAi';
import { getTabCoordinator } from '@/utils/tabCoordinator';
import { recordManualSyncMetrics, setActiveListenersCount } from '@/utils/performanceMetrics';
import { commitQueuedNoteSafely } from '@/utils/noteSyncTransaction';
import { getOfflineMediaSyncService, summarizePendingMedia } from '@/utils/offlineMediaSyncService';
import { reconcileRemoteNotesSnapshot, hasMeaningfulNoteDifference, getConflictIdentity } from '@/utils/noteReconciliation';
import { getPendingMediaForUser } from '@/utils/offlineMediaQueue';

const resolvedConflictIdentities = new Set<string>();
import {
  saveJSONSafe,
  persistDurableNotes,
  persistDurableSyncQueue,
  loadDurableRecord,
  peekCrashJournal,
  acknowledgeCrashJournal,
  markDurableMigrationComplete,
  isDurableMigrationComplete,
} from '@/utils/durableOutbox';

// ── Helpers ──
const now = () => new Date().toISOString();
const loadJSON = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const saveJSON = (key: string, data: unknown) => {
  saveJSONSafe(key, data);
};

// ── Account-scoped workspace management ──
// Each authenticated user gets their own localStorage namespace keyed by
// Firebase UID. Guests (unauthenticated) use a separate namespace.
// This prevents User A's private data from leaking to User B when they
// sign in on the same browser/profile.
let activeWorkspacePrefix = 'ntk:guest';

/** All short keys that belong to a workspace namespace. */
const WORKSPACE_SHORT_KEYS = [
  'notes', 'notebooks', 'profile', 'settings', 'onboarded', 'scratchpad',
  'saved-searches', 'team-spaces', 'activity-items', 'notifications',
  'reminders', 'sync-queue', 'sync-conflicts', 'triggered-reminders',
] as const;

/** Legacy global keys from Round 1 (un-namespaced). */
const LEGACY_GLOBAL_KEYS = WORKSPACE_SHORT_KEYS.map(k => `ntk-${k}`);

/** Build a fully-qualified localStorage key for the active workspace. */
const wsKey = (shortKey: string) => `${activeWorkspacePrefix}:${shortKey}`;

/** Read from the active workspace namespace. */
const loadWS = <T>(shortKey: string, fallback: T): T => loadJSON(wsKey(shortKey), fallback);

/** Write to the active workspace namespace. */
const saveWS = (shortKey: string, data: unknown) => saveJSON(wsKey(shortKey), data);

/** Switch the active workspace prefix. Does NOT load/save data — callers handle that. */
const setWorkspacePrefix = (uid: string | null) => {
  activeWorkspacePrefix = uid ? `ntk:user:${uid}` : 'ntk:guest';
};

let authSessionGeneration = 0;

/** Namespace prefix for quarantined legacy data requiring manual inspection. */
export const LEGACY_RECOVERY_PREFIX = 'ntk:legacy-recovery';

/**
 * Migrate legacy un-namespaced global keys to a specific user's workspace.
 * STRICT SAFETY RULE (Round 3):
 * - Auto-migration occurs ONLY if:
 *   1. Legacy data contains explicit ownership metadata (withOwner > 0).
 *   2. 100% of owner-tagged legacy notes belong to the target UID (ownedByTarget === withOwner).
 *   3. Target user does not already have namespaced data.
 * - In ALL other cases (missing metadata, zero notes with other legacy artifacts, mixed accounts, or target has existing data),
 *   legacy data is QUARANTINED safely to `ntk:legacy-recovery:*` and never assigned automatically.
 * - Quarantined data is never initialized into Firestore or queued for sync.
 * - Users can explicitly recover quarantined data via `recoverQuarantinedData(uid)`.
 */
const migrateLegacyData = (targetUid: string): { migrated: boolean; quarantined: boolean } => {
  const hasLegacy = LEGACY_GLOBAL_KEYS.some(k => localStorage.getItem(k) !== null);
  if (!hasLegacy) return { migrated: false, quarantined: false };

  const targetPrefix = `ntk:user:${targetUid}`;
  const hasExistingData = localStorage.getItem(`${targetPrefix}:notes`) !== null;

  // Inspect legacy notes for ownership metadata
  const legacyNotes = loadJSON<Array<{ ownerId?: string }>>('ntk-notes', []);
  const withOwner = legacyNotes.filter(n => typeof n.ownerId === 'string' && n.ownerId.length > 0).length;
  const ownedByTarget = legacyNotes.filter(n => n.ownerId === targetUid).length;

  // Strict ownership proof:
  // Must NOT already have target data, MUST have owner metadata, and 100% of owner-tagged notes must belong to targetUid
  const canSafelyAutoMigrate = !hasExistingData && withOwner > 0 && ownedByTarget === withOwner;

  if (canSafelyAutoMigrate) {
    WORKSPACE_SHORT_KEYS.forEach(shortKey => {
      const legacyKey = `ntk-${shortKey}`;
      const raw = localStorage.getItem(legacyKey);
      if (raw !== null) {
        localStorage.setItem(`${targetPrefix}:${shortKey}`, raw);
      }
    });
    LEGACY_GLOBAL_KEYS.forEach(k => localStorage.removeItem(k));
    console.info(`[NTK] Safely migrated 100% verified legacy data to user ${targetUid.slice(0, 8)}…`);
    return { migrated: true, quarantined: false };
  } else {
    // Quarantine legacy data safely under ntk:legacy-recovery:*
    WORKSPACE_SHORT_KEYS.forEach(shortKey => {
      const legacyKey = `ntk-${shortKey}`;
      const raw = localStorage.getItem(legacyKey);
      if (raw !== null) {
        const recoveryKey = `${LEGACY_RECOVERY_PREFIX}:${shortKey}`;
        if (localStorage.getItem(recoveryKey) === null) {
          localStorage.setItem(recoveryKey, raw);
        }
      }
    });
    LEGACY_GLOBAL_KEYS.forEach(k => localStorage.removeItem(k));
    console.warn(`[NTK] Legacy data quarantined to '${LEGACY_RECOVERY_PREFIX}' — ownership cannot be assumed automatically for user ${targetUid.slice(0, 8)}…`);
    return { migrated: false, quarantined: true };
  }
};

/**
 * Explicit recovery helper: imports quarantined legacy data into the current user's workspace
 * only when explicitly initiated by the user.
 */
export const recoverQuarantinedData = (targetUid: string): boolean => {
  const targetPrefix = `ntk:user:${targetUid}`;
  let count = 0;
  WORKSPACE_SHORT_KEYS.forEach(shortKey => {
    const recoveryKey = `${LEGACY_RECOVERY_PREFIX}:${shortKey}`;
    const raw = localStorage.getItem(recoveryKey);
    if (raw !== null) {
      localStorage.setItem(`${targetPrefix}:${shortKey}`, raw);
      localStorage.removeItem(recoveryKey);
      count++;
    }
  });
  return count > 0;
};

const stripUndefined = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const definedOnly = <T extends Record<string, unknown>>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;

const fontValue = (label: string): string => {
  const normalized = label === 'system-ui' ? 'System Default' : label;
  return premiumFontFamilies.find(font => font.label === normalized || font.value === normalized)?.value
    || premiumFontFamilies.find(font => font.label === 'Inter')?.value
    || 'Inter, ui-sans-serif, system-ui, sans-serif';
};

const countWords = (text: string) => text.trim() ? text.trim().split(/\s+/).length : 0;
const countChars = (text: string) => text.length;

const syncTimers: Record<string, { timer: ReturnType<typeof setTimeout>; baseUpdatedAt?: string }> = {};
let syncFlushPromise: Promise<void> | null = null;
let manualSyncInFlight: { uid: string; promise: Promise<ManualSyncResult> } | null = null;
let syncFeedbackTimer: ReturnType<typeof setTimeout> | null = null;
let directorySyncTimer: ReturnType<typeof setTimeout> | null = null;
const activityThrottle: Record<string, number> = {};
const NOTIFICATION_LIMIT = 300;
const MANUAL_SYNC_TIMEOUT_MS = 20_000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
};

const sortNotifications = (items: AppNotification[]) =>
  [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

const capNotifications = (items: AppNotification[]) => sortNotifications(items).slice(0, NOTIFICATION_LIMIT);

const directoryRecord = (profile: Pick<UserProfile, 'name' | 'email' | 'initials' | 'avatar' | 'discoverable'>, uid?: string | null) => {
  const name = profile.name.trim().slice(0, 120);
  const email = normalizeEmail(profile.email);
  const initials = profile.initials.slice(0, 4);
  const record: Record<string, unknown> = {
    name,
    email,
    initials,
    searchPrefixes: buildDirectorySearchPrefixes(name, email),
    discoverable: profile.discoverable !== false,
    updatedAt: now(),
  };
  if (uid) {
    record.uid = uid;
  }
  if (profile.avatar && (profile.avatar.startsWith('http://') || profile.avatar.startsWith('https://'))) {
    record.photoURL = profile.avatar.slice(0, 500);
  }
  return record;
};

// ── Default Data ──
const defaultNotebook: Notebook = {
  id: 'default',
  name: 'My Notebook',
  parentId: null,
  color: 'indigo',
  icon: '📓',
  createdAt: now(),
  order: 0,
  sections: [],
};

const defaultProfile: UserProfile = {
  name: '',
  email: '',
  initials: '',
  avatar: 'builtin:aurora',
  avatarSource: undefined,
  createdAt: now(),
};

const defaultSettings: AppSettings = {
  theme: 'light',
  accent: 'indigo',
  sidebarCollapsed: false,
  noteListCollapsed: false,
  editorPanelCollapsed: false,
  defaultNoteType: 'note',
  defaultNoteTheme: 'canvas',
  defaultNotebook: 'default',
  editorFontSize: 16,
  editorFontFamily: fontValue('Inter'),
  density: 'comfortable',
  showWordCount: true,
  autoSave: true,
  spellCheck: true,
  zenMode: false,
  noteViewMode: 'grid',
  notebookSortBy: 'manual',
  notebookSortDir: 'asc',
  offlineModeEnabled: false,
  notificationsEnabled: true,
  browserNotificationsEnabled: false,
  reminderNotificationsEnabled: true,
  celebrationNotificationsEnabled: true,
  collaborationNotificationsEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
  celebrationReminderTime: '08:00',
  defaultSnoozeMinutes: 10,
  hasSeenTour: false,
  backupReminderDays: 14,
  aiEnabled: true,
  aiDefaultScope: 'selection',
  aiWritingStyle: 'natural',
  aiConfirmWholeNote: true,
  storageGuardEnabled: true,
  storageGuardTargetGb: 8,
  voiceNoteQuality: 'standard',
  voiceNoteMaxDurationMinutes: 15,
};

const defaultSearchFilters: SearchFilters = {
  query: '',
  tags: [],
  notebooks: [],
  colors: [],
  types: [],
  priorities: [],
  hasReminder: null,
  hasChecklist: null,
  dateRange: null,
  sharedBy: [],
  sortBy: 'updatedAt',
  sortDir: 'desc',
};

const defaultTemplates: NoteTemplate[] = [
  {
    id: 'tpl-meeting',
    name: 'Meeting Notes',
    description: 'Structure for capturing meeting details',
    icon: '🤝',
    content: '# Meeting Notes\n\n**Date:** \n**Attendees:** \n**Agenda:**\n\n---\n\n## Discussion Points\n\n1. \n\n## Action Items\n\n- [ ] \n\n## Next Steps\n\n',
    type: 'note',
    tags: ['meeting'],
    checklist: [],
  },
  {
    id: 'tpl-journal',
    name: 'Daily Journal',
    description: 'Daily reflection and gratitude',
    icon: '📔',
    content: '# Daily Journal\n\n**Date:** \n\n## 🙏 Gratitude\n\n1. \n2. \n3. \n\n## 📝 Today\'s Highlights\n\n\n\n## 💡 Ideas & Insights\n\n\n\n## 🎯 Tomorrow\'s Goals\n\n- [ ] \n',
    type: 'note',
    tags: ['journal', 'daily'],
    checklist: [],
  },
  {
    id: 'tpl-project',
    name: 'Project Plan',
    description: 'Project planning template',
    icon: '🚀',
    content: '# Project: [Name]\n\n## Overview\n\n**Goal:** \n**Deadline:** \n**Status:** 🟡 In Progress\n\n## Milestones\n\n- [ ] Phase 1: \n- [ ] Phase 2: \n- [ ] Phase 3: \n\n## Resources\n\n\n## Notes\n\n',
    type: 'note',
    tags: ['project'],
    checklist: [],
  },
  {
    id: 'tpl-todo',
    name: 'To-Do List',
    description: 'Simple task checklist',
    icon: '✅',
    content: '',
    type: 'checklist',
    tags: ['todo'],
    checklist: [
      { id: uuid(), text: 'Task 1', checked: false, order: 0 },
      { id: uuid(), text: 'Task 2', checked: false, order: 1 },
      { id: uuid(), text: 'Task 3', checked: false, order: 2 },
    ],
  },
  {
    id: 'tpl-weekly',
    name: 'Weekly Review',
    description: 'Weekly reflection and planning',
    icon: '📅',
    content: '# Weekly Review\n\n**Week of:** \n\n## ✅ Accomplishments\n\n\n\n## 🚧 Challenges\n\n\n\n## 📊 Key Metrics\n\n\n\n## 🎯 Next Week\'s Priorities\n\n1. \n2. \n3. \n\n## 💭 Reflections\n\n',
    type: 'note',
    tags: ['weekly', 'review'],
    checklist: [],
  },
  {
    id: 'tpl-brainstorm',
    name: 'Brainstorm',
    description: 'Free-form idea generation',
    icon: '💡',
    content: '# Brainstorm: [Topic]\n\n## Core Idea\n\n\n\n## Related Ideas\n\n- \n- \n- \n\n## Pros & Cons\n\n| Pros | Cons |\n|------|------|\n|  |  |\n\n## Next Steps\n\n',
    type: 'note',
    tags: ['brainstorm', 'ideas'],
    checklist: [],
  },
  {
    id: 'tpl-cv',
    name: 'CV / Resume',
    description: 'Professional CV starter with sample wording you can replace with your real experience',
    icon: '📄',
    content: '# CV / Resume\n\n## Professional Summary\n\n## Core Skills\n\n## Work Experience\n\n## Education\n\n## Certifications & Training\n\n## Additional Information\n',
    type: 'note',
    theme: 'graphite',
    tags: ['career', 'cv', 'resume', 'job'],
    checklist: [],
  },
  {
    id: 'tpl-cover-letter',
    name: 'Cover Letter',
    description: 'Professional job application letter with an editable example',
    icon: '✉️',
    content: '# Cover Letter\n\n## Opening\n\n## Why I am a good fit\n\n## Why this role\n\n## Closing\n',
    type: 'note',
    theme: 'canvas',
    tags: ['career', 'job', 'application'],
    checklist: [],
  },
];

const checklist = (...items: string[]): ChecklistItem[] =>
  items.map((text, order) => ({ id: uuid(), text, checked: false, order }));

const premiumTemplates: NoteTemplate[] = [
  {
    id: 'tpl-executive-brief',
    name: 'Executive Brief',
    description: 'One-page leadership summary for decisions and updates',
    icon: 'BR',
    content: '# Executive Brief\n\n## Context\n\n## Key Takeaways\n\n1. \n2. \n3. \n\n## Decision Needed\n\n## Risks\n\n## Recommended Next Step\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['brief', 'leadership'],
    checklist: [],
  },
  {
    id: 'tpl-product-requirements',
    name: 'Product Requirements',
    description: 'PRD structure for features, scope, risks, and launch criteria',
    icon: 'PR',
    content: '# Product Requirements\n\n## Problem\n\n## Goals\n\n## Non-Goals\n\n## User Stories\n\n- As a user, I want to...\n\n## Requirements\n\n| Priority | Requirement | Notes |\n| --- | --- | --- |\n| Must |  |  |\n\n## Success Metrics\n\n## Launch Checklist\n\n',
    type: 'markdown',
    theme: 'ocean',
    tags: ['product', 'prd'],
    checklist: [],
  },
  {
    id: 'tpl-sprint-plan',
    name: 'Sprint Plan',
    description: 'Plan team commitments, blockers, and delivery focus',
    icon: 'SP',
    content: '# Sprint Plan\n\n## Sprint Goal\n\n## Committed Work\n\n## Dependencies\n\n## Risks\n\n## Demo Plan\n\n',
    type: 'checklist',
    theme: 'mint',
    tags: ['sprint', 'planning'],
    checklist: checklist('Confirm sprint goal', 'Prioritize backlog', 'Assign owners', 'Review dependencies', 'Schedule demo'),
  },
  {
    id: 'tpl-client-crm',
    name: 'Client CRM Note',
    description: 'Relationship snapshot for accounts, contacts, and follow-ups',
    icon: 'CRM',
    content: '# Client: [Name]\n\n## Contacts\n\n## Current Needs\n\n## Conversation Notes\n\n## Opportunities\n\n## Follow-up Plan\n\n',
    type: 'markdown',
    theme: 'canvas',
    tags: ['client', 'crm'],
    checklist: [],
  },
  {
    id: 'tpl-research-brief',
    name: 'Research Brief',
    description: 'Capture sources, insights, evidence, and synthesis',
    icon: 'RS',
    content: '# Research Brief\n\n## Question\n\n## Sources\n\n| Source | Finding | Confidence |\n| --- | --- | --- |\n|  |  |  |\n\n## Insights\n\n## Open Questions\n\n## Summary\n\n',
    type: 'markdown',
    theme: 'ocean',
    tags: ['research'],
    checklist: [],
  },
  {
    id: 'tpl-content-calendar',
    name: 'Content Calendar',
    description: 'Plan publish dates, channels, assets, and approvals',
    icon: 'CC',
    content: '# Content Calendar\n\n## Month\n\n| Date | Channel | Topic | Owner | Status |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |\n\n## Themes\n\n## Asset Needs\n\n',
    type: 'markdown',
    theme: 'sunset',
    tags: ['content', 'calendar'],
    checklist: [],
  },
  {
    id: 'tpl-meeting-decision-log',
    name: 'Decision Log',
    description: 'Track major decisions with rationale and owners',
    icon: 'DL',
    content: '# Decision Log\n\n| Date | Decision | Rationale | Owner | Review Date |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |\n\n## Notes\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['decision', 'log'],
    checklist: [],
  },
  {
    id: 'tpl-goal-system',
    name: 'Goal System',
    description: 'Plan outcomes, milestones, habits, and review rhythm',
    icon: 'GS',
    content: '# Goal System\n\n## Outcome\n\n## Why It Matters\n\n## Milestones\n\n## Habits\n\n## Weekly Review Questions\n\n',
    type: 'checklist',
    theme: 'forest',
    tags: ['goals', 'review'],
    checklist: checklist('Define measurable outcome', 'Set first milestone', 'Choose weekly review time', 'Identify blockers'),
  },
  {
    id: 'tpl-study-notes',
    name: 'Study Notes',
    description: 'Structured learning notes with recall and summary prompts',
    icon: 'ST',
    content: '# Study Notes\n\n## Topic\n\n## Core Concepts\n\n## Examples\n\n## Questions to Revisit\n\n## Five-Sentence Summary\n\n',
    type: 'markdown',
    theme: 'lavender',
    tags: ['study', 'learning'],
    checklist: [],
  },
  {
    id: 'tpl-book-notes',
    name: 'Book Notes',
    description: 'Capture highlights, arguments, quotes, and action ideas',
    icon: 'BK',
    content: '# Book Notes\n\n## Book\n\n## Big Idea\n\n## Key Arguments\n\n## Quotes\n\n## Ideas to Apply\n\n## Final Summary\n\n',
    type: 'markdown',
    theme: 'parchment',
    tags: ['book', 'reading'],
    checklist: [],
  },
  {
    id: 'tpl-habit-tracker',
    name: 'Habit Tracker',
    description: 'Daily habit checklist with reflection prompts',
    icon: 'HT',
    content: '# Habit Tracker\n\n## Week Of\n\n## Reflection\n\nWhat worked?\n\nWhat needs adjustment?\n\n',
    type: 'checklist',
    theme: 'mint',
    tags: ['habits', 'routine'],
    checklist: checklist('Morning review', 'Deep work block', 'Movement', 'Reading', 'Evening shutdown'),
  },
  {
    id: 'tpl-budget-review',
    name: 'Budget Review',
    description: 'Monthly finance review for income, spend, and priorities',
    icon: 'BR',
    content: '# Budget Review\n\n## Month\n\n## Income\n\n## Expenses\n\n| Category | Planned | Actual | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Savings Goals\n\n## Next Month Adjustments\n\n',
    type: 'markdown',
    theme: 'forest',
    tags: ['finance', 'budget'],
    checklist: [],
  },
  {
    id: 'tpl-wellness-log',
    name: 'Wellness Log',
    description: 'Gentle personal check-in for health, energy, and mood',
    icon: 'WL',
    content: '# Wellness Log\n\n## Today\n\nEnergy:\nMood:\nSleep:\n\n## What Helped\n\n## What Felt Heavy\n\n## One Kind Next Step\n\n',
    type: 'markdown',
    theme: 'rose',
    tags: ['wellness', 'personal'],
    checklist: [],
  },
  {
    id: 'tpl-travel-plan',
    name: 'Travel Plan',
    description: 'Itinerary, bookings, packing, and local notes',
    icon: 'TP',
    content: '# Travel Plan\n\n## Destination\n\n## Itinerary\n\n| Day | Plan | Booking | Notes |\n| --- | --- | --- | --- |\n|  |  |  |  |\n\n## Packing\n\n## Important Details\n\n',
    type: 'checklist',
    theme: 'sunset',
    tags: ['travel'],
    checklist: checklist('Confirm dates', 'Book accommodation', 'Save tickets', 'Pack essentials', 'Share itinerary'),
  },
  {
    id: 'tpl-investor-update',
    name: 'Investor Update',
    description: 'Monthly traction, wins, risks, and asks for stakeholders',
    icon: 'IU',
    content: '# Investor Update\n\n## Highlights\n\n## Metrics\n\n| Metric | Current | Previous | Notes |\n| --- | --- | --- | --- |\n| Revenue |  |  |  |\n| Users |  |  |  |\n\n## Wins\n\n## Risks\n\n## Asks\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['investor', 'update'],
    checklist: [],
  },
  {
    id: 'tpl-board-meeting',
    name: 'Board Meeting',
    description: 'Agenda, resolutions, questions, and follow-up owners',
    icon: 'BM',
    content: '# Board Meeting\n\n## Agenda\n\n## Pre-Reads\n\n## Decisions\n\n## Questions\n\n## Follow-ups\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['board', 'meeting'],
    checklist: [],
  },
  {
    id: 'tpl-sales-call',
    name: 'Sales Call Brief',
    description: 'Discovery notes, pain points, objections, and next steps',
    icon: 'SC',
    content: '# Sales Call Brief\n\n## Account\n\n## Stakeholders\n\n## Pain Points\n\n## Current Process\n\n## Objections\n\n## Next Step\n\n',
    type: 'markdown',
    theme: 'canvas',
    tags: ['sales', 'crm'],
    checklist: [],
  },
  {
    id: 'tpl-customer-support',
    name: 'Support Case',
    description: 'Issue diagnosis, reproduction, resolution, and follow-up',
    icon: 'CS',
    content: '# Support Case\n\n## Customer\n\n## Issue\n\n## Steps to Reproduce\n\n## Investigation\n\n## Resolution\n\n## Follow-up\n\n',
    type: 'checklist',
    theme: 'ocean',
    tags: ['support', 'customer'],
    checklist: checklist('Confirm issue details', 'Reproduce issue', 'Document workaround', 'Confirm resolution'),
  },
  {
    id: 'tpl-launch-plan',
    name: 'Launch Plan',
    description: 'Premium go-to-market launch checklist and command center',
    icon: 'LP',
    content: '# Launch Plan\n\n## Objective\n\n## Audience\n\n## Messaging\n\n## Channels\n\n## Timeline\n\n## Launch Risks\n\n',
    type: 'checklist',
    theme: 'sunset',
    tags: ['launch', 'marketing'],
    checklist: checklist('Finalize positioning', 'Approve assets', 'Schedule launch comms', 'Prepare support notes', 'Review launch metrics'),
  },
  {
    id: 'tpl-marketing-campaign',
    name: 'Marketing Campaign',
    description: 'Campaign strategy, audience, assets, budget, and measurement',
    icon: 'MC',
    content: '# Marketing Campaign\n\n## Campaign Goal\n\n## Audience\n\n## Offer\n\n## Channels\n\n## Asset List\n\n## Budget\n\n## Success Metrics\n\n',
    type: 'markdown',
    theme: 'lavender',
    tags: ['marketing', 'campaign'],
    checklist: [],
  },
  {
    id: 'tpl-brand-voice',
    name: 'Brand Voice',
    description: 'Tone, language, proof points, and messaging guardrails',
    icon: 'BV',
    content: '# Brand Voice\n\n## Personality\n\n## Tone Guidelines\n\n## Words We Use\n\n## Words We Avoid\n\n## Proof Points\n\n## Sample Copy\n\n',
    type: 'markdown',
    theme: 'rose',
    tags: ['brand', 'copy'],
    checklist: [],
  },
  {
    id: 'tpl-interview-notes',
    name: 'Interview Notes',
    description: 'Candidate scorecard, questions, signals, and decision notes',
    icon: 'IN',
    content: '# Interview Notes\n\n## Candidate\n\n## Role\n\n## Scorecard\n\n| Signal | Evidence | Rating |\n| --- | --- | --- |\n| Skill |  |  |\n| Culture |  |  |\n\n## Decision\n\n',
    type: 'markdown',
    theme: 'canvas',
    tags: ['hiring', 'interview'],
    checklist: [],
  },
  {
    id: 'tpl-onboarding-plan',
    name: 'Onboarding Plan',
    description: 'First-week plan for a new hire, client, or project member',
    icon: 'OP',
    content: '# Onboarding Plan\n\n## Person / Team\n\n## Outcomes\n\n## Day 1\n\n## Week 1\n\n## First 30 Days\n\n## Resources\n\n',
    type: 'checklist',
    theme: 'mint',
    tags: ['onboarding', 'people'],
    checklist: checklist('Send welcome packet', 'Schedule intro meetings', 'Share key documents', 'Set first milestone'),
  },
  {
    id: 'tpl-retrospective',
    name: 'Retrospective',
    description: 'Thoughtful team retro for lessons, decisions, and actions',
    icon: 'RT',
    content: '# Retrospective\n\n## What Went Well\n\n## What Was Hard\n\n## What We Learned\n\n## Actions\n\n',
    type: 'checklist',
    theme: 'forest',
    tags: ['retro', 'team'],
    checklist: checklist('Collect wins', 'Collect pain points', 'Choose top actions', 'Assign owners'),
  },
  {
    id: 'tpl-incident-report',
    name: 'Incident Report',
    description: 'Production incident timeline, impact, root cause, and actions',
    icon: 'IR',
    content: '# Incident Report\n\n## Summary\n\n## Impact\n\n## Timeline\n\n| Time | Event |\n| --- | --- |\n|  |  |\n\n## Root Cause\n\n## Corrective Actions\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['incident', 'engineering'],
    checklist: [],
  },
  {
    id: 'tpl-postmortem',
    name: 'Postmortem',
    description: 'Blameless review for system failures and process gaps',
    icon: 'PM',
    content: '# Postmortem\n\n## What Happened\n\n## Detection\n\n## Response\n\n## Root Causes\n\n## What Worked\n\n## What Changes\n\n',
    type: 'markdown',
    theme: 'midnight',
    tags: ['postmortem', 'ops'],
    checklist: [],
  },
  {
    id: 'tpl-api-design',
    name: 'API Design',
    description: 'Endpoint design, contracts, errors, auth, and examples',
    icon: 'API',
    content: '# API Design\n\n## Goal\n\n## Endpoints\n\n| Method | Path | Purpose |\n| --- | --- | --- |\n| GET |  |  |\n\n## Request / Response\n\n## Errors\n\n## Security\n\n',
    type: 'markdown',
    theme: 'ocean',
    tags: ['api', 'engineering'],
    checklist: [],
  },
  {
    id: 'tpl-writing-brief',
    name: 'Writing Brief',
    description: 'Editorial brief for essays, articles, and long-form writing',
    icon: 'WB',
    content: '# Writing Brief\n\n## Thesis\n\n## Audience\n\n## Outline\n\n## Sources\n\n## Draft Notes\n\n## Revision Checklist\n\n',
    type: 'markdown',
    theme: 'parchment',
    tags: ['writing', 'editorial'],
    checklist: [],
  },
  {
    id: 'tpl-podcast-episode',
    name: 'Podcast Episode',
    description: 'Episode rundown, guest prep, segments, and production notes',
    icon: 'PE',
    content: '# Podcast Episode\n\n## Episode Topic\n\n## Guest\n\n## Segments\n\n## Questions\n\n## Sponsor / CTA\n\n## Production Notes\n\n',
    type: 'checklist',
    theme: 'lavender',
    tags: ['podcast', 'content'],
    checklist: checklist('Confirm guest', 'Prepare questions', 'Record episode', 'Edit audio', 'Publish assets'),
  },
  {
    id: 'tpl-course-lesson',
    name: 'Course Lesson',
    description: 'Lesson plan with objectives, examples, exercises, and recap',
    icon: 'CL',
    content: '# Course Lesson\n\n## Learning Objective\n\n## Concept\n\n## Example\n\n## Exercise\n\n## Recap\n\n## Homework\n\n',
    type: 'markdown',
    theme: 'mint',
    tags: ['course', 'education'],
    checklist: [],
  },
  {
    id: 'tpl-legal-review',
    name: 'Legal Review',
    description: 'Contract or policy review with risks, clauses, and decisions',
    icon: 'LR',
    content: '# Legal Review\n\n## Document\n\n## Business Context\n\n## Key Clauses\n\n## Risks\n\n## Questions\n\n## Decision\n\n',
    type: 'markdown',
    theme: 'graphite',
    tags: ['legal', 'review'],
    checklist: [],
  },
  {
    id: 'tpl-real-estate-tour',
    name: 'Property Tour',
    description: 'Compare properties, notes, costs, pros, and cons',
    icon: 'PT',
    content: '# Property Tour\n\n## Property\n\n## Price / Terms\n\n## Pros\n\n## Cons\n\n## Questions\n\n## Follow-up\n\n',
    type: 'checklist',
    theme: 'forest',
    tags: ['property', 'planning'],
    checklist: checklist('Confirm address', 'Take photos', 'Estimate costs', 'Compare options'),
  },
  {
    id: 'tpl-event-plan',
    name: 'Event Plan',
    description: 'Venue, schedule, vendors, budget, guests, and run of show',
    icon: 'EV',
    content: '# Event Plan\n\n## Event Goal\n\n## Venue\n\n## Guest List\n\n## Run of Show\n\n## Budget\n\n## Vendor Notes\n\n',
    type: 'checklist',
    theme: 'sunset',
    tags: ['event', 'planning'],
    checklist: checklist('Confirm venue', 'Invite guests', 'Book vendors', 'Finalize run of show', 'Prepare day-of kit'),
  },
  {
    id: 'tpl-family-command-center',
    name: 'Family Command Center',
    description: 'Household planning, errands, meals, appointments, and reminders',
    icon: 'FC',
    content: '# Family Command Center\n\n## Week Of\n\n## Appointments\n\n## Meals\n\n## Errands\n\n## Notes\n\n',
    type: 'checklist',
    theme: 'rose',
    tags: ['family', 'home'],
    checklist: checklist('Plan meals', 'Review appointments', 'List errands', 'Check school/work notes'),
  },
];

// ── Store Interface ──
interface AppState {
  // Data
  notes: Note[];
  notebooks: Notebook[];
  tags: Tag[];
  templates: NoteTemplate[];
  savedSearches: SavedSearch[];
  teamSpaces: TeamSpace[];
  activityItems: ActivityItem[];
  notifications: AppNotification[];
  reminders: AppReminder[];
  profile: UserProfile;
  settings: AppSettings;
  
  // UI State
  currentView: SidebarView;
  previousView: SidebarView | null;
  settingsSection: string;
  selectedNoteId: string | null;
  selectedNotebookId: string | null;
  selectedTagId: string | null;
  editingNote: boolean;
  searchFilters: SearchFilters;
  isOnboarded: boolean;
  sidebarOpen: boolean;
  commandPaletteOpen: boolean;
  syncQueue: SyncQueueItem[];
  syncConflicts: SyncConflict[];
  conflictRecoveryNotice: ConflictRecoveryNotice | null;
  dismissConflictRecoveryNotice: () => void;
  online: boolean;
  syncStatus: SyncStatus;
  syncMessage: string;
  lastManualSyncAt: string | null;
  unlockedNotes: Record<string, { title: string; content: string; checklist: ChecklistItem[]; password: string }>;
  syncCenterOpen: boolean;
  setSyncCenterOpen: (open: boolean) => void;
  
  // Scratch pad
  scratchPad: string;

  // Messaging & AI Context
  activeChatId: string | null;
  setActiveChatId: (chatId: string | null) => void;
  aiNoteContext: { noteId: string; noteTitle: string; noteContent?: string } | null;
  setAiNoteContext: (context: { noteId: string; noteTitle: string; noteContent?: string } | null) => void;
  
  // Actions — Auth & Sync
  uid: string | null;
  unsubscribeNotes: (() => void) | null;
  unsubscribeNotebooks: (() => void) | null;
  unsubscribeSettings: (() => void) | null;
  unsubscribeTeamSpaces: (() => void) | null;
  authEpoch: number;
  unsubscribeActivity: (() => void) | null;
  unsubscribeNotifications: (() => void) | null;
  unsubscribeReminders: (() => void) | null;
  unsubscribeSharedNotes: (() => void) | null;
  unsubscribeSharedNotebooks: (() => void) | null;
  initFirestore: (uid: string) => Promise<void>;
  hydrateAuthenticatedWorkspace: (uid: string) => Promise<void>;
  clearAuth: () => void;

  // Actions — Profile
  setProfile: (profile: Partial<UserProfile>) => void;
  completeOnboarding: (name: string, email?: string, avatar?: string) => void;
  
  // Actions — Settings
  updateSettings: (settings: Partial<AppSettings>) => void;
  setTheme: (theme: ThemeMode) => void;
  setAccent: (accent: ThemeAccent) => void;
  setNoteTheme: (id: string, theme: NoteTheme) => Promise<void>;
  toggleZenMode: () => void;
  flushSyncQueue: () => Promise<void>;
  manualSync: () => Promise<ManualSyncResult>;
  resolveSyncConflict: (conflictId: string, strategy?: SyncConflictStrategy, conflictOverride?: SyncConflict) => Promise<void>;
  setOnlineStatus: (online: boolean) => void;

  // Actions — Notifications
  addNotification: (notification: Omit<AppNotification, 'id' | 'createdAt'> & { id?: string; createdAt?: string }) => AppNotification;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  dismissNotification: (id: string) => void;
  snoozeNotification: (id: string, minutes: number) => void;
  recordNotificationDelivery: (id: string) => void;
  clearDismissedNotifications: () => void;

  // Actions — Reminders
  createReminder: (input: {
    title: string;
    dueAt: string;
    noteId?: string;
    details?: string;
    priority?: Priority;
    status?: ReminderStatus;
  }) => Promise<AppReminder>;
  updateReminder: (id: string, updates: Partial<AppReminder>) => Promise<void>;
  deleteReminder: (id: string) => Promise<void>;
  toggleReminderStatus: (id: string) => Promise<void>;
  snoozeReminderItem: (id: string, minutes: 5 | 10 | 30 | 60 | 'tomorrow') => Promise<void>;
  getAllReminders: () => AppReminder[];
  
  // Actions — Notes
  createNote: (partial: Partial<Note>) => Promise<Note>;
  updateNote: (id: string, updates: Partial<Note>, immediateSync?: boolean) => Promise<void>;
  trashNote: (id: string) => Promise<void>;
  bulkTrashNotes: (ids: string[]) => Promise<void>;
  restoreNote: (id: string) => Promise<void>;
  deleteNote: (id: string) => Promise<DeletionResult>;
  bulkDeleteNotes: (ids: string[]) => Promise<DeletionResult>;
  emptyTrash: () => Promise<DeletionResult>;
  restoreAll: () => Promise<void>;
  cleanupTrashOlderThan: (days: number) => Promise<{ notes: number; notebooks: number }>;
  archiveNote: (id: string) => Promise<void>;
  unarchiveNote: (id: string) => Promise<void>;
  pinNote: (id: string) => Promise<void>;
  starNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<Note | null>;
  moveNote: (noteId: string, notebookId: string) => Promise<void>;
  setNoteColor: (id: string, color: NoteColor) => Promise<void>;
  setNotePriority: (id: string, priority: Priority | null) => Promise<void>;
  addNoteTag: (noteId: string, tag: string) => Promise<void>;
  removeNoteTag: (noteId: string, tag: string) => Promise<void>;
  setNoteReminder: (noteId: string, reminder: Reminder | undefined) => Promise<void>;
  reorderNotes: (noteIds: string[]) => Promise<void>;
  lockNote: (noteId: string, password: string, hint?: string) => Promise<boolean>;
  unlockNote: (noteId: string, password: string) => Promise<boolean>;
  relockNote: (noteId: string) => void;
  updateUnlockedNote: (noteId: string, updates: { title?: string; content?: string; checklist?: ChecklistItem[] }, immediateSync?: boolean) => Promise<void>;
  
  // Actions — Checklist
  addChecklistItem: (noteId: string, text: string) => Promise<void>;
  updateChecklistItem: (noteId: string, itemId: string, updates: Partial<ChecklistItem>) => Promise<void>;
  removeChecklistItem: (noteId: string, itemId: string) => Promise<void>;
  reorderChecklist: (noteId: string, itemIds: string[]) => Promise<void>;
  
  // Actions — Notebooks
  createNotebook: (name: string, parentId?: string | null, icon?: string) => Notebook;
  updateNotebook: (id: string, updates: Partial<Notebook>) => void;
  reorderNotebook: (id: string, parentId: string | null, targetIndex: number) => void;
  deleteNotebook: (id: string) => void;
  restoreNotebook: (id: string) => void;
  permanentlyDeleteNotebook: (id: string) => Promise<DeletionResult>;
  addSection: (notebookId: string, name: string) => Section;
  updateSection: (notebookId: string, sectionId: string, updates: Partial<Section>) => void;
  deleteSection: (notebookId: string, sectionId: string) => void;
  
  // Actions — Tags
  createTag: (name: string, color?: NoteColor) => Tag;
  deleteTag: (id: string) => void;
  renameTag: (id: string, name: string) => void;
  
  // Actions — Search & Navigation
  setSearchFilters: (filters: Partial<SearchFilters>) => void;
  clearSearch: () => void;
  setCurrentView: (view: SidebarView) => void;
  navigateBack: () => void;
  openSettings: (section?: string) => void;
  selectNote: (id: string | null) => void;
  selectNotebook: (id: string | null) => void;
  selectTag: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setCommandPaletteOpen: (open: boolean) => void;
  setEditingNote: (editing: boolean) => void;
  saveCurrentSearch: (name: string) => SavedSearch;
  applySavedSearch: (id: string) => void;
  deleteSavedSearch: (id: string) => void;

  // Actions — Scratch Pad
  updateScratchPad: (content: string) => void;
  
  // Actions — Templates
  createFromTemplate: (templateId: string, options?: { title?: string; values?: Record<string, string>; includeExamples?: boolean }) => Promise<Note | null>;
  
  createTeamSpace: (name: string, notebookIds?: string[]) => TeamSpace;
  updateTeamSpace: (id: string, updates: Partial<TeamSpace>) => void;
  deleteTeamSpace: (id: string) => void;
  addActivity: (item: Omit<ActivityItem, 'id' | 'createdAt' | 'actorEmail' | 'actorName'> & { actorEmail?: string; actorName?: string }) => Promise<ActivityItem>;
  shareNote: (noteId: string, sharedWith: string[], isPublished: boolean, shareAccess?: ShareAccess[]) => Promise<void>;
  shareNotebook: (notebookId: string, sharedWith: string[], shareAccess?: ShareAccess[]) => Promise<void>;
  
  // Actions — Export/Import
  exportAllNotes: () => string;
  importNotes: (json: string) => boolean;
  resetApp: () => Promise<void>;

  // Actions — Cloud snapshot backups
  createCloudBackup: (trigger?: CloudBackupMeta['trigger']) => Promise<CloudBackupMeta>;
  fetchCloudBackups: () => Promise<CloudBackupMeta[]>;
  restoreCloudBackup: (backupId: string, mode?: 'merge' | 'replace') => Promise<{ restoredNotes: number; restoredNotebooks: number }>;
  deleteCloudBackup: (backupId: string) => Promise<void>;
  
  // Computed
  getFilteredNotes: () => Note[];
  getRecentNotes: (limit?: number) => Note[];
  getPinnedNotes: () => Note[];
  getStarredNotes: () => Note[];
  getArchivedNotes: () => Note[];
  getTrashedNotes: () => Note[];
  getNotesByNotebook: (notebookId: string) => Note[];
  getNotesByTag: (tag: string) => Note[];
  getNoteById: (id: string) => Note | undefined;
  getNotebookById: (id: string) => Notebook | undefined;
  getChildNotebooks: (parentId: string | null) => Notebook[];
  getAllTags: () => Tag[];
  getStats: () => { notes: number; words: number; tags: number; notebooks: number; tasks: number; completedTasks: number; };
  getReminders: () => Reminder[];
}

export const useStore = create<AppState>((set, get) => {
  // ── Load workspace data helper (used at init and on workspace switch) ──
  const loadWorkspaceData = () => {
    const notes = loadWS<Note[]>('notes', []);
    const notebooks = loadWS<Notebook[]>('notebooks', [defaultNotebook]);
    const profile = loadWS<UserProfile>('profile', defaultProfile);
    const settings = { ...defaultSettings, ...loadWS<Partial<AppSettings>>('settings', {}) };
    settings.editorFontFamily = fontValue(settings.editorFontFamily);
    const isOnboarded = loadWS<boolean>('onboarded', false);
    const scratchPad = loadWS<string>('scratchpad', '');
    const savedSearches = loadWS<SavedSearch[]>('saved-searches', []);
    const teamSpaces = loadWS<TeamSpace[]>('team-spaces', []);
    const activityItems = loadWS<ActivityItem[]>('activity-items', []);
    const notifications = capNotifications(loadWS<AppNotification[]>('notifications', []));
    const loadedReminders = loadWS<AppReminder[]>('reminders', []);
    // Backfill any legacy note.reminder into reminders map
    const remindersMap = new Map<string, AppReminder>();
    loadedReminders.forEach(r => remindersMap.set(r.id, r));
    notes.forEach(n => {
      if (n.reminder && !n.trashed) {
        const rid = n.reminder.id || `reminder-note-${n.id}`;
        if (!remindersMap.has(rid)) {
          remindersMap.set(rid, {
            id: rid,
            ownerId: n.ownerId,
            noteId: n.id,
            title: n.reminder.title || n.title || 'Note reminder',
            dueAt: n.reminder.time,
            status: 'active',
            triggered: !!n.reminder.triggered,
            createdAt: n.createdAt || now(),
            updatedAt: n.updatedAt || now(),
          });
        }
      }
    });
    const reminders = [...remindersMap.values()];
    const syncQueue = loadWS<SyncQueueItem[]>('sync-queue', []);
    const syncConflicts = loadWS<SyncConflict[]>('sync-conflicts', []);
    return {
      notes, notebooks, profile, settings, isOnboarded, scratchPad,
      savedSearches, teamSpaces, activityItems, notifications,
      reminders, syncQueue, syncConflicts,
      tags: rebuildTagsFromNotes(notes),
    };
  };

  // Rebuild tags from notes (standalone version used before store is ready)
  const rebuildTagsFromNotes = (notes: Note[]): Tag[] => {
    const tagMap = new Map<string, number>();
    notes.filter(n => !n.trashed).forEach(n => {
      (n.tags || []).forEach(t => tagMap.set(t, (tagMap.get(t) || 0) + 1));
    });
    return Array.from(tagMap.entries()).map(([name, count]) => ({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      color: 'default' as NoteColor,
      count,
    }));
  };

  // Load initial state from guest workspace
  const initialData = loadWorkspaceData();
  const migratedUids = new Set<string>();

  // Persist helper — writes all workspace data to the active namespace.
  // §6: For authenticated migrated users, IndexedDB is the heavy-state authority.
  // Full notes and sync queue are NOT continuously serialized into localStorage once migration succeeds.
  // localStorage retains small settings, profile, metadata, and crash journals.
  const persist = () => {
    const state = get();
    const uid = state.uid;
    const isMigrated = Boolean(uid && migratedUids.has(uid));

    if (!isMigrated) {
      saveWS('notes', state.notes);
      saveWS('sync-queue', state.syncQueue);
    }
    saveWS('notebooks', state.notebooks);
    saveWS('profile', state.profile);
    saveWS('settings', state.settings);
    saveWS('onboarded', state.isOnboarded);
    saveWS('scratchpad', state.scratchPad);
    saveWS('saved-searches', state.savedSearches);
    saveWS('team-spaces', state.teamSpaces);
    saveWS('activity-items', state.activityItems.slice(0, 200));
    saveWS('notifications', capNotifications(state.notifications));
    saveWS('reminders', state.reminders);
    saveWS('sync-conflicts', state.syncConflicts);

    // Durable heavy state authority in IndexedDB
    if (uid) {
      void persistDurableNotes(uid, state.notes);
      void persistDurableSyncQueue(uid, state.syncQueue);
    }
  };

  // Alias for rebuildTagsFromNotes (used throughout the store actions)
  const rebuildTags = rebuildTagsFromNotes;

  const enqueueSync = (
    noteId: string,
    operation: SyncQueueItem['operation'],
    entityType: SyncQueueItem['entityType'] = 'note',
    metadata?: Pick<SyncQueueItem, 'wasShared' | 'ownerId' | 'baseUpdatedAt'>,
  ) => {
    set(s => {
      const queue = s.syncQueue.filter(item => !(item.noteId === noteId && (item.entityType || 'note') === entityType));
      return {
        syncQueue: [
          ...queue,
          { id: uuid(), noteId, operation, createdAt: now(), attempts: 0, entityType, ...metadata },
        ],
      };
    });
    persist();
  };

  const flushQueuedSync = (): Promise<void> => {
    const currentGen = authSessionGeneration;
    const targetUid = get().uid;
    if (!targetUid) return Promise.resolve();

    syncFlushPromise = (async () => {
      while (true) {
        if (currentGen !== authSessionGeneration || get().uid !== targetUid) return;
        const state = get();
        if (!state.uid || !state.online || state.syncQueue.length === 0) return;

        const conflictIds = new Set(state.syncConflicts.map(conflict => conflict.noteId));
        const item = state.syncQueue.find(queued =>
          (queued.entityType || 'note') !== 'note' || !conflictIds.has(queued.noteId)
        );
        if (!item) return;

        const isNotebook = item.entityType === 'notebook';
        const isTeamSpace = item.entityType === 'teamSpace';
        const isNotification = item.entityType === 'notification';
        const isReminder = item.entityType === 'reminder';

        try {
          if (isReminder) {
            const reminder = get().reminders.find(itemRecord => itemRecord.id === item.noteId);
            if (item.operation === 'delete') {
              await deleteDoc(doc(db, `users/${state.uid}/reminders`, item.noteId));
            } else if (reminder) {
              await setDoc(doc(db, `users/${state.uid}/reminders`, item.noteId), stripUndefined(reminder));
            }
          } else if (isNotification) {
            const notification = get().notifications.find(itemRecord => itemRecord.id === item.noteId);
            if (item.operation === 'delete') {
              await deleteDoc(doc(db, `users/${state.uid}/notifications`, item.noteId));
            } else if (notification) {
              await setDoc(doc(db, `users/${state.uid}/notifications`, item.noteId), stripUndefined(notification));
            }
          } else if (isTeamSpace) {
            const teamSpace = get().teamSpaces.find(space => space.id === item.noteId);
            if (item.operation === 'delete') {
              await deleteDoc(doc(db, `users/${state.uid}/team_spaces`, item.noteId));
            } else if (teamSpace) {
              await setDoc(doc(db, `users/${state.uid}/team_spaces`, item.noteId), stripUndefined(teamSpace));
            }
          } else if (isNotebook) {
            const nb = get().notebooks.find(n => n.id === item.noteId);
            if (item.operation === 'delete') {
              if (item.wasShared && item.ownerId === state.uid) {
                await deleteDoc(doc(db, `users/${state.uid}/notebooks`, item.noteId));
                await deleteDoc(doc(db, 'shared_notebooks', item.noteId));
              } else {
                await deleteDoc(doc(db, `users/${state.uid}/notebooks`, item.noteId));
              }
            } else if (nb) {
              if (nb.isShared) {
                await setDoc(doc(db, 'shared_notebooks', item.noteId), stripUndefined(nb));
                if (nb.ownerId === state.uid) {
                  await setDoc(doc(db, `users/${state.uid}/notebooks`, item.noteId), stripUndefined(nb));
                }
              } else {
                await setDoc(doc(db, `users/${state.uid}/notebooks`, item.noteId), stripUndefined(nb));
              }
            }
          } else {
            const note = get().notes.find(n => n.id === item.noteId);
            if (item.operation === 'delete') {
              if (item.wasShared && item.ownerId === state.uid) {
                await deleteDoc(doc(db, `users/${state.uid}/notes`, item.noteId));
                await deleteDoc(doc(db, 'shared_notes', item.noteId));
              } else {
                await deleteDoc(doc(db, `users/${state.uid}/notes`, item.noteId));
              }
            } else if (note) {
              // Atomic compare-and-write via Firestore transaction
              const commitResult = await commitQueuedNoteSafely(db, state.uid, note, item);
              if (commitResult.status === 'conflict') {
                if (currentGen === authSessionGeneration && get().uid === targetUid) {
                  const conflictId = uuid();
                  const conflict: SyncConflict = {
                    id: conflictId,
                    noteId: item.noteId,
                    local: note,
                    remote: commitResult.remoteNote,
                    detectedAt: now(),
                  };
                  await get().resolveSyncConflict(conflictId, 'auto_safe', conflict);
                }
                continue;
              } else if (commitResult.status === 'remote_deleted') {
                // Note was deleted on another device. Safely recover user edits into new private note.
                if (currentGen === authSessionGeneration && get().uid === targetUid) {
                  const conflictId = uuid();
                  const conflict: SyncConflict = {
                    id: conflictId,
                    noteId: item.noteId,
                    local: note,
                    detectedAt: now(),
                    deletedRemotely: true,
                  };
                  await get().resolveSyncConflict(conflictId, 'auto_safe', conflict);
                }
                continue;
              } else if (commitResult.status === 'failed') {
                // FAIL CLOSED: do NOT remove from queue, do not write anyway
                // Increment attempt count and EXIT the flush loop to prevent hot retry storm.
                console.warn('[Sync] Atomic commit failed closed:', commitResult.error);
                if (currentGen === authSessionGeneration && get().uid === targetUid) {
                  set(s => ({
                    syncQueue: s.syncQueue.map(queued =>
                      queued.id === item.id ? { ...queued, attempts: queued.attempts + 1 } : queued
                    ),
                  }));
                  persist();
                }
                return; // EXIT flush — do NOT continue to retry in tight loop
              }
            }
          }

          if (currentGen === authSessionGeneration && get().uid === targetUid) {
            set(s => ({ syncQueue: s.syncQueue.filter(queued => queued.id !== item.id) }));
            persist();
          }
        } catch (error) {
          console.warn('Sync queued for retry:', error);
          if (currentGen === authSessionGeneration && get().uid === targetUid) {
            set(s => ({
              syncQueue: s.syncQueue.map(queued =>
                queued.id === item.id ? { ...queued, attempts: queued.attempts + 1 } : queued
              ),
            }));
            persist();
          }
          return;
        }
      }
    })().finally(() => {
      syncFlushPromise = null;
    });

    return syncFlushPromise;
  };

  const queueDebouncedNoteEdits = () => {
    const pendingNoteIds = Object.keys(syncTimers);
    pendingNoteIds.forEach(noteId => {
      const timerMeta = syncTimers[noteId];
      clearTimeout(timerMeta.timer);
      const preservedBaseUpdatedAt = timerMeta.baseUpdatedAt;
      delete syncTimers[noteId];
      const state = get();
      const queuedDelete = state.syncQueue.some(item =>
        (item.entityType || 'note') === 'note' && item.noteId === noteId && item.operation === 'delete'
      );
      if (!queuedDelete && state.notes.some(note => note.id === noteId)) {
        enqueueSync(noteId, 'upsert', 'note', preservedBaseUpdatedAt ? { baseUpdatedAt: preservedBaseUpdatedAt } : undefined);
      }
    });
    return pendingNoteIds.length;
  };

  const setSyncFeedback = (status: Exclude<SyncStatus, 'syncing'>, message: string) => {
    if (syncFeedbackTimer) clearTimeout(syncFeedbackTimer);
    set({ syncStatus: status, syncMessage: message });
    syncFeedbackTimer = setTimeout(() => {
      if (get().syncStatus === status) set({ syncStatus: 'idle', syncMessage: '' });
      syncFeedbackTimer = null;
    }, status === 'success' ? 4_000 : 8_000);
  };

  const syncNoteToFirestore = (noteId: string, debounceMs = 0, baseUpdatedAt?: string) => {
    if (debounceMs > 0) {
      // Preserve the FIRST remote baseline for this editing session.
      // If a timer already exists, keep its original baseUpdatedAt — do NOT overwrite with a later local timestamp.
      const existingMeta = syncTimers[noteId];
      const preservedBase = existingMeta?.baseUpdatedAt || baseUpdatedAt;
      if (existingMeta) {
        clearTimeout(existingMeta.timer);
      }
      const timer = setTimeout(() => {
        const meta = syncTimers[noteId];
        const finalBase = meta?.baseUpdatedAt;
        delete syncTimers[noteId];
        enqueueSync(noteId, 'upsert', 'note', finalBase ? { baseUpdatedAt: finalBase } : undefined);
        void flushQueuedSync();
      }, debounceMs);
      syncTimers[noteId] = { timer, baseUpdatedAt: preservedBase };
    } else {
      // Immediate sync — clear any pending debounce and preserve its baseline
      const existingMeta = syncTimers[noteId];
      const preservedBase = existingMeta?.baseUpdatedAt || baseUpdatedAt;
      if (existingMeta) {
        clearTimeout(existingMeta.timer);
        delete syncTimers[noteId];
      }
      enqueueSync(noteId, 'upsert', 'note', preservedBase ? { baseUpdatedAt: preservedBase } : undefined);
      void flushQueuedSync();
    }
  };

  const syncNotebookToFirestore = (notebookId: string) => {
    enqueueSync(notebookId, 'upsert', 'notebook');
    void flushQueuedSync();
  };

  const syncTeamSpaceToFirestore = (teamSpaceId: string) => {
    enqueueSync(teamSpaceId, 'upsert', 'teamSpace');
    void flushQueuedSync();
  };

  const deleteTeamSpaceFromFirestore = (teamSpaceId: string) => {
    enqueueSync(teamSpaceId, 'delete', 'teamSpace');
    void flushQueuedSync();
  };

  const syncNotificationToFirestore = (notificationId: string) => {
    enqueueSync(notificationId, 'upsert', 'notification');
    void flushQueuedSync();
  };

  const deleteNotificationFromFirestore = (notificationId: string) => {
    enqueueSync(notificationId, 'delete', 'notification');
    void flushQueuedSync();
  };

  const syncReminderToFirestore = (reminderId: string) => {
    enqueueSync(reminderId, 'upsert', 'reminder');
    void flushQueuedSync();
  };

  const deleteReminderFromFirestore = (reminderId: string) => {
    enqueueSync(reminderId, 'delete', 'reminder');
    void flushQueuedSync();
  };

  const syncSettingsToFirestore = (settings?: AppSettings) => {
    const { uid } = get();
    if (!uid) return;
    void setDoc(doc(db, `users/${uid}/meta/settings`), stripUndefined(settings || get().settings), { merge: true }).catch(console.error);
  };

  const getNotebookTreeIds = (notebookId: string) => {
    const ids = new Set([notebookId]);
    let changed = true;
    while (changed) {
      changed = false;
      get().notebooks.forEach(nb => {
        if (nb.parentId && ids.has(nb.parentId) && !ids.has(nb.id)) {
          ids.add(nb.id);
          changed = true;
        }
      });
    }
    return ids;
  };

  const sortNotebooksByOrder = (items: Notebook[]) =>
    [...items].sort((a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
      a.name.localeCompare(b.name)
    );

  return {
    notes: initialData.notes,
    notebooks: initialData.notebooks.length ? initialData.notebooks : [defaultNotebook],
    tags: initialData.tags,
    templates: [...defaultTemplates, ...premiumTemplates],
    savedSearches: initialData.savedSearches,
    teamSpaces: initialData.teamSpaces,
    activityItems: initialData.activityItems,
    notifications: initialData.notifications,
    reminders: initialData.reminders,
    profile: initialData.profile,
    settings: initialData.settings,
    currentView: 'home',
    previousView: null,
    settingsSection: 'profile',
    selectedNoteId: null,
    selectedNotebookId: null,
    selectedTagId: null,
    editingNote: false,
    searchFilters: defaultSearchFilters,
    isOnboarded: initialData.isOnboarded,
    sidebarOpen: false,
    commandPaletteOpen: false,
    syncQueue: initialData.syncQueue,
    syncConflicts: initialData.syncConflicts,
    conflictRecoveryNotice: null,
    dismissConflictRecoveryNotice: () => set({ conflictRecoveryNotice: null }),
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncStatus: 'idle',
    syncMessage: '',
    lastManualSyncAt: null,
    unlockedNotes: {},
    syncCenterOpen: false,
    setSyncCenterOpen: (syncCenterOpen: boolean) => set({ syncCenterOpen }),
    activeChatId: null,
    aiNoteContext: null,
    uid: null,
    authEpoch: 0,
    unsubscribeNotes: null,
    unsubscribeNotebooks: null,
    unsubscribeSettings: null,
    unsubscribeTeamSpaces: null,
    unsubscribeActivity: null,
    unsubscribeNotifications: null,
    unsubscribeReminders: null,
    unsubscribeSharedNotes: null,
    unsubscribeSharedNotebooks: null,
    
    hydrateAuthenticatedWorkspace: async (uid: string) => {
      const outgoingUid = get().uid;
      if (outgoingUid && outgoingUid !== uid) {
        persist(); // Save outgoing workspace before switching namespace
        set({
          activeChatId: null,
          aiNoteContext: null,
          authEpoch: get().authEpoch + 1,
        });
      }
      migrateLegacyData(uid); // Strict legacy migration / quarantine for this user
      setWorkspacePrefix(uid); // Switch active namespace to ntk:user:{uid}
      const userData = loadWorkspaceData();

      // ── Durable IndexedDB Hydration (§2-§9) ──
      try {
        const durable = await loadDurableRecord(uid);
        let migrationDone = await isDurableMigrationComplete(uid);
        if (migrationDone) {
          migratedUids.add(uid);
        }

        // Determine best source for notes
        if (durable.notes && durable.notes.length > 0) {
          const durableTime = durable.notesUpdatedAt ? new Date(durable.notesUpdatedAt).getTime() : 0;
          const lsMaxTime = userData.notes.length > 0
            ? Math.max(...userData.notes.map(n => new Date(n.updatedAt).getTime()))
            : 0;

          // Prefer IndexedDB if: (a) migration done, OR (b) IndexedDB is newer, OR (c) localStorage empty
          if (migrationDone || durableTime >= lsMaxTime || userData.notes.length === 0) {
            userData.notes = durable.notes;
          }
        }

        // Determine best source for sync queue
        if (durable.queue && durable.queue.length > 0) {
          const durableQueueTime = durable.queueUpdatedAt ? new Date(durable.queueUpdatedAt).getTime() : 0;
          const merged = new Map<string, typeof userData.syncQueue[0]>();
          for (const item of userData.syncQueue) {
            merged.set(`${item.noteId}:${item.entityType || 'note'}`, item);
          }
          if (durableQueueTime > 0 || userData.syncQueue.length === 0) {
            for (const item of durable.queue) {
              const key = `${item.noteId}:${item.entityType || 'note'}`;
              if (!merged.has(key)) {
                merged.set(key, item);
              }
            }
          }
          userData.syncQueue = [...merged.values()];
        }

        // Legacy Migration Safety (§7): Write localStorage data to IndexedDB AND verify read-back
        if (!migrationDone && userData.notes.length > 0) {
          const writeOk = await persistDurableNotes(uid, userData.notes);
          if (writeOk) {
            const readBack = await loadDurableRecord(uid);
            if (readBack.notes && readBack.notes.length >= userData.notes.length) {
              await markDurableMigrationComplete(uid);
              migratedUids.add(uid);
              migrationDone = true;
            }
          }
          await persistDurableSyncQueue(uid, userData.syncQueue);
        }

        // Crash Journal Recovery (§9): Peek journal, restore content AND sync intent, persist, verify, acknowledge
        const journalEntries = peekCrashJournal(uid);
        if (journalEntries.length > 0) {
          for (const entry of journalEntries) {
            const idx = userData.notes.findIndex(n => n.id === entry.noteId);
            if (idx >= 0) {
              userData.notes[idx] = {
                ...userData.notes[idx],
                title: entry.title,
                content: entry.content,
                updatedAt: entry.updatedAt,
              };
            } else {
              userData.notes.push({
                id: entry.noteId,
                title: entry.title,
                content: entry.content,
                updatedAt: entry.updatedAt,
                createdAt: entry.updatedAt,
                tags: [],
                color: 'default',
                pinned: false,
                archived: false,
                trashed: false,
                ownerId: uid,
              } as unknown as Note);
            }
            // Restore sync intent: ensure a pending sync item exists with baseUpdatedAt
            const hasQueueItem = userData.syncQueue.some(
              q => q.noteId === entry.noteId && (q.entityType || 'note') === 'note'
            );
            if (!hasQueueItem) {
              userData.syncQueue.push({
                id: uuid(),
                noteId: entry.noteId,
                operation: 'upsert',
                createdAt: now(),
                attempts: 0,
                entityType: 'note',
                baseUpdatedAt: entry.baseUpdatedAt || entry.updatedAt,
              });
            }
          }

          // Persist verified recovered durable state BEFORE acknowledging journal
          const writeNotesOk = await persistDurableNotes(uid, userData.notes);
          const writeQueueOk = await persistDurableSyncQueue(uid, userData.syncQueue);
          if (writeNotesOk && writeQueueOk) {
            acknowledgeCrashJournal(uid, journalEntries);
          }
        }
      } catch (err) {
        console.warn('[NTK] Durable hydration failed, using localStorage fallback:', err);
      }

      // Apply final hydrated state to Zustand store
      set({
        uid,
        notes: userData.notes,
        notebooks: userData.notebooks.length ? userData.notebooks : [defaultNotebook],
        tags: rebuildTags(userData.notes),
        profile: userData.profile,
        settings: userData.settings,
        isOnboarded: userData.isOnboarded,
        scratchPad: userData.scratchPad,
        savedSearches: userData.savedSearches,
        teamSpaces: userData.teamSpaces,
        activityItems: userData.activityItems,
        notifications: userData.notifications,
        reminders: userData.reminders,
        syncQueue: userData.syncQueue,
        syncConflicts: userData.syncConflicts,
        conflictRecoveryNotice: null,
      });

      persist();
    },

    initFirestore: async (uid) => {
      // ── Teardown any previous listeners and invalidate in-flight async operations ──
      const sessionGen = ++authSessionGeneration;
      const {
        unsubscribeNotes: prevUnsubNotes,
        unsubscribeNotebooks: prevUnsubNotebooks,
        unsubscribeSettings: prevUnsubSettings,
        unsubscribeTeamSpaces: prevUnsubTeamSpaces,
        unsubscribeActivity: prevUnsubActivity,
        unsubscribeNotifications: prevUnsubNotifications,
        unsubscribeReminders: prevUnsubReminders,
        unsubscribeSharedNotes: prevUnsubSharedNotes,
        unsubscribeSharedNotebooks: prevUnsubSharedNotebooks
      } = get();

      if (prevUnsubNotes) { try { prevUnsubNotes(); } catch {} }
      if (prevUnsubNotebooks) { try { prevUnsubNotebooks(); } catch {} }
      if (prevUnsubSettings) { try { prevUnsubSettings(); } catch {} }
      if (prevUnsubTeamSpaces) { try { prevUnsubTeamSpaces(); } catch {} }
      if (prevUnsubActivity) { try { prevUnsubActivity(); } catch {} }
      if (prevUnsubNotifications) { try { prevUnsubNotifications(); } catch {} }
      if (prevUnsubReminders) { try { prevUnsubReminders(); } catch {} }
      if (prevUnsubSharedNotes) { try { prevUnsubSharedNotes(); } catch {} }
      if (prevUnsubSharedNotebooks) { try { prevUnsubSharedNotebooks(); } catch {} }

      if (syncFeedbackTimer) {
        clearTimeout(syncFeedbackTimer);
        syncFeedbackTimer = null;
      }
      if (directorySyncTimer) {
        clearTimeout(directorySyncTimer);
        directorySyncTimer = null;
      }

      // Step 1: Durable Hydration MUST complete BEFORE any Firestore listeners attach
      await get().hydrateAuthenticatedWorkspace(uid);
      if (sessionGen !== authSessionGeneration || get().uid !== uid) return;

      const profile = get().profile;
      if (uid && profile.email) {
        void setDoc(
          doc(db, 'users_directory', normalizeEmail(profile.email)),
          directoryRecord(profile, uid),
          { merge: true }
        ).catch(error => console.warn('Could not sync directory profile:', error));
      }

      const notesRef = collection(db, `users/${uid}/notes`);
      const unsubscribe = onSnapshot(notesRef, (snapshot) => {
        if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
        const notes = snapshot.docs.map(doc => doc.data() as Note);
        set(s => {
          if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
          const result = reconcileRemoteNotesSnapshot(
            s.notes,
            notes,
            s.syncQueue,
            uid,
            s.syncConflicts
          );
          return {
            notes: result.notes,
            tags: rebuildTags(result.notes),
            syncConflicts: result.syncConflicts,
          };
        });
        if (sessionGen === authSessionGeneration && get().uid === uid) {
          persist();
          const pendingConflicts = get().syncConflicts;
          if (pendingConflicts.length > 0) {
            for (const c of pendingConflicts) {
              void get().resolveSyncConflict(c.id, 'auto_safe');
            }
          }
          void flushQueuedSync();
        }
      }, (error) => {
        console.error("Firestore sync error:", error);
      });

      // Synchronize notebooks
      const notebooksRef = collection(db, `users/${uid}/notebooks`);
      const unsubscribeNbs = onSnapshot(notebooksRef, (snapshot) => {
        if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
        const remoteNbs = snapshot.docs.map(doc => doc.data() as Notebook);
        set(s => {
          if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
          const externallyShared = s.notebooks.filter(nb => nb.isShared && nb.ownerId !== uid);
          const mergedPrivate = s.notebooks.filter(nb => !(nb.isShared && nb.ownerId !== uid));
          const remoteIds = new Set(remoteNbs.map(nb => nb.id));
          const pendingIds = new Set(s.syncQueue.filter(item => item.entityType === 'notebook').map(item => item.noteId));

          remoteNbs.forEach(remote => {
            const idx = mergedPrivate.findIndex(nb => nb.id === remote.id);
            if (idx >= 0) {
              if (!pendingIds.has(remote.id)) {
                mergedPrivate[idx] = remote;
              }
            } else {
              mergedPrivate.push(remote);
            }
          });

          const privateNbs = mergedPrivate.filter(nb => remoteIds.has(nb.id) || pendingIds.has(nb.id) || nb.id === 'default');
          const combined = new Map<string, Notebook>();
          privateNbs.forEach(nb => combined.set(nb.id, nb));
          externallyShared.forEach(nb => combined.set(nb.id, nb));
          return { notebooks: [...combined.values()] };
        });
        if (sessionGen === authSessionGeneration && get().uid === uid) {
          saveWS('notebooks', get().notebooks);
          void flushQueuedSync();
        }
      }, (error) => {
        console.error("Firestore notebooks sync error:", error);
      });

      const settingsRef = doc(db, `users/${uid}/meta/settings`);
      let isFirstSettingsSnapshot = true;
      const unsubscribeSettings = onSnapshot(settingsRef, (snapshot) => {
        if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
        if (snapshot.exists()) {
          const remoteSettings = snapshot.data() as Partial<AppSettings>;
          set(s => {
            if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
            const settings = { ...s.settings, ...remoteSettings };
            settings.editorFontFamily = fontValue(settings.editorFontFamily);
            return { settings };
          });
          persist();
        } else if (isFirstSettingsSnapshot) {
          void setDoc(settingsRef, stripUndefined(get().settings), { merge: true }).catch(console.error);
        }
        isFirstSettingsSnapshot = false;
      }, (error) => {
        console.error("Firestore settings sync error:", error);
      });

      const teamSpacesRef = collection(db, `users/${uid}/team_spaces`);
      let isFirstTeamSpacesSnapshot = true;
      const unsubscribeTeamSpaces = onSnapshot(teamSpacesRef, (snapshot) => {
        if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
        const remoteSpaces = snapshot.docs.map(doc => doc.data() as TeamSpace);
        set(s => {
          if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
          const merged = [...s.teamSpaces];
          const remoteIds = new Set(remoteSpaces.map(space => space.id));
          const pendingIds = new Set(s.syncQueue.filter(item => item.entityType === 'teamSpace').map(item => item.noteId));

          if (isFirstTeamSpacesSnapshot) {
            s.teamSpaces.forEach(space => {
              if (!remoteIds.has(space.id) && !pendingIds.has(space.id)) {
                void setDoc(doc(db, `users/${uid}/team_spaces`, space.id), stripUndefined(space)).catch(console.error);
                remoteIds.add(space.id);
              }
            });
            isFirstTeamSpacesSnapshot = false;
          }

          remoteSpaces.forEach(remote => {
            const idx = merged.findIndex(space => space.id === remote.id);
            if (idx >= 0) {
              if (!pendingIds.has(remote.id)) {
                merged[idx] = remote;
              }
            } else {
              merged.push(remote);
            }
          });

          return {
            teamSpaces: remoteIds.size === 0
              ? merged
              : merged.filter(space => remoteIds.has(space.id) || pendingIds.has(space.id)),
          };
        });
        if (sessionGen === authSessionGeneration && get().uid === uid) {
          saveWS('team-spaces', get().teamSpaces);
          void flushQueuedSync();
        }
      }, (error) => {
        console.error("Firestore team spaces sync error:", error);
      });

      const notificationsRef = collection(db, `users/${uid}/notifications`);
      let isFirstNotificationsSnapshot = true;
      const unsubscribeNotifications = onSnapshot(notificationsRef, (snapshot) => {
        if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
        const remoteNotifications = snapshot.docs.map(doc => doc.data() as AppNotification);
        set(s => {
          if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
          const merged = new Map<string, AppNotification>();
          s.notifications.forEach(notification => merged.set(notification.id, notification));
          const remoteIds = new Set(remoteNotifications.map(notification => notification.id));
          const pendingIds = new Set(s.syncQueue.filter(item => item.entityType === 'notification').map(item => item.noteId));

          if (isFirstNotificationsSnapshot) {
            s.notifications.forEach(notification => {
              if (!remoteIds.has(notification.id) && !pendingIds.has(notification.id)) {
                void setDoc(doc(db, `users/${uid}/notifications`, notification.id), stripUndefined(notification)).catch(console.error);
                remoteIds.add(notification.id);
              }
            });
            isFirstNotificationsSnapshot = false;
          }

          remoteNotifications.forEach(remote => {
            if (!pendingIds.has(remote.id)) {
              merged.set(remote.id, remote);
            }
          });

          return { notifications: capNotifications([...merged.values()]) };
        });
        if (sessionGen === authSessionGeneration && get().uid === uid) {
          saveWS('notifications', get().notifications);
          void flushQueuedSync();
        }
      }, (error) => {
        console.error("Firestore notifications sync error:", error);
      });

      const remindersRef = collection(db, `users/${uid}/reminders`);
      let isFirstRemindersSnapshot = true;
      const unsubscribeReminders = onSnapshot(remindersRef, (snapshot) => {
        if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
        const remoteReminders = snapshot.docs.map(doc => doc.data() as AppReminder);
        set(s => {
          if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
          const remoteIds = new Set(remoteReminders.map(reminder => reminder.id));
          const pendingIds = new Set(s.syncQueue.filter(item => item.entityType === 'reminder').map(item => item.noteId));

          if (isFirstRemindersSnapshot) {
            // Upload local-only reminders that aren't in Firestore yet
            s.reminders.forEach(reminder => {
              if (!remoteIds.has(reminder.id) && !pendingIds.has(reminder.id)) {
                void setDoc(doc(db, `users/${uid}/reminders`, reminder.id), stripUndefined(reminder)).catch(console.error);
                remoteIds.add(reminder.id);
              }
            });
            isFirstRemindersSnapshot = false;
          }

          // Build merged set: remote is authoritative after first snapshot.
          // Local reminders are retained ONLY if they have a pending sync entry.
          const merged = new Map<string, AppReminder>();

          // Start with remote reminders
          remoteReminders.forEach(remote => {
            if (!pendingIds.has(remote.id)) {
              merged.set(remote.id, remote);
            } else {
              const local = s.reminders.find(r => r.id === remote.id);
              merged.set(remote.id, local || remote);
            }
          });

          // Preserve local-only reminders ONLY if they have a pending sync
          s.reminders.forEach(reminder => {
            if (!remoteIds.has(reminder.id) && pendingIds.has(reminder.id)) {
              merged.set(reminder.id, reminder);
            }
          });

          return { reminders: [...merged.values()] };
        });
        if (sessionGen === authSessionGeneration && get().uid === uid) {
          saveWS('reminders', get().reminders);
          void flushQueuedSync();
        }
      }, (error) => {
        console.error("Firestore reminders sync error:", error);
      });

      // Synchronize shared notes & notebooks real-time
      const email = auth.currentUser?.email;
      let unsubscribeSharedNotes = () => {};
      let unsubscribeSharedNotebooks = () => {};
      let unsubscribeActivity = () => {};

      if (email) {
        const normalizedEmail = normalizeEmail(email);
        // ── Subscriber-side: notes shared WITH this user ──
        const sharedNotesQuery = query(collection(db, 'shared_notes'), where('sharedWith', 'array-contains', normalizedEmail));
        const unsubSharedReceived = onSnapshot(sharedNotesQuery, (snapshot) => {
          if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
          const sharedNotes = snapshot.docs.map(doc => ({
            ...doc.data(),
            isShared: true
          } as Note));
          
          set(s => {
            if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
            const privateNotes = s.notes.filter(n => !(n.isShared && n.ownerId !== uid));
            const merged = [...privateNotes];
            
            sharedNotes.forEach(shared => {
              const idx = merged.findIndex(n => n.id === shared.id);
              if (idx >= 0) {
                merged[idx] = shared;
              } else {
                merged.push(shared);
              }
            });
            return { notes: merged, tags: rebuildTags(merged) };
          });
        }, (error) => {
          console.error("Firestore shared notes sync error:", error);
        });

        // ── Owner-side: notes this user owns that are shared ──
        // Ensures the owner sees editor changes via the shared_notes authority.
        const ownedSharedQuery = query(collection(db, 'shared_notes'), where('ownerId', '==', uid));
        const unsubSharedOwned = onSnapshot(ownedSharedQuery, (snapshot) => {
          if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
          const ownedSharedNotes = snapshot.docs.map(doc => doc.data() as Note);
          
          set(s => {
            if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
            const updated = [...s.notes];
            ownedSharedNotes.forEach(shared => {
              const idx = updated.findIndex(n => n.id === shared.id);
              if (idx >= 0) {
                // Update the private copy with the shared authority's content
                updated[idx] = {
                  ...updated[idx],
                  title: shared.title,
                  content: shared.content,
                  updatedAt: shared.updatedAt,
                  tags: shared.tags,
                };
              }
            });
            return { notes: updated, tags: rebuildTags(updated) };
          });
          if (sessionGen === authSessionGeneration && get().uid === uid) {
            persist();
          }
        }, (error) => {
          console.error("Firestore owned-shared notes sync error:", error);
        });

        // Combine both shared note unsubs into one
        unsubscribeSharedNotes = () => {
          unsubSharedReceived();
          unsubSharedOwned();
        };

        const sharedNotebooksQuery = query(collection(db, 'shared_notebooks'), where('sharedWith', 'array-contains', normalizedEmail));
        unsubscribeSharedNotebooks = onSnapshot(sharedNotebooksQuery, (snapshot) => {
          if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
          const sharedNotebooks = snapshot.docs.map(doc => ({
            ...doc.data(),
            isShared: true
          } as Notebook));
          
          set(s => {
            if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
            const privateNbs = s.notebooks.filter(nb => !(nb.isShared && nb.ownerId !== uid));
            const merged = [...privateNbs];
            
            sharedNotebooks.forEach(shared => {
              const idx = merged.findIndex(nb => nb.id === shared.id);
              if (idx >= 0) {
                merged[idx] = shared;
              } else {
                merged.push(shared);
              }
            });
            return { notebooks: merged };
          });
        }, (error) => {
          console.error("Firestore shared notebooks sync error:", error);
        });

        // Bounded activity feed query — limit(200) with newest-first ordering
        const activityQuery = query(
          collection(db, 'activity_feed'),
          where('participants', 'array-contains', normalizedEmail),
          orderBy('createdAt', 'desc'),
          limit(200)
        );
        unsubscribeActivity = onSnapshot(activityQuery, (snapshot) => {
          if (sessionGen !== authSessionGeneration || get().uid !== uid) return;
          const remoteActivity = snapshot.docs.map(doc => doc.data() as ActivityItem);
          set(s => {
            if (sessionGen !== authSessionGeneration || s.uid !== uid) return {};
            const merged = new Map<string, ActivityItem>();
            [...remoteActivity, ...s.activityItems].forEach(item => merged.set(item.id, item));
            return {
              activityItems: [...merged.values()]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .slice(0, 200),
            };
          });
          if (sessionGen === authSessionGeneration && get().uid === uid) {
            saveWS('activity-items', get().activityItems.slice(0, 200));
          }
        }, (error) => {
          console.error("Firestore activity feed sync error:", error);
        });
      }

      set({
        unsubscribeNotes: unsubscribe,
        unsubscribeNotebooks: unsubscribeNbs,
        unsubscribeSettings,
        unsubscribeTeamSpaces,
        unsubscribeActivity,
        unsubscribeNotifications,
        unsubscribeReminders,
        unsubscribeSharedNotes,
        unsubscribeSharedNotebooks
      });
      setActiveListenersCount(email ? 9 : 6);
      void flushQueuedSync();
      if (uid) {
        void retryPendingMediaCleanups(uid).catch(() => 0);
        void retryPendingReminderCleanups(uid).catch(() => 0);
      }
    },

    clearAuth: () => {
      // Invalidate session generation so in-flight listener callbacks are discarded
      ++authSessionGeneration;
      setActiveListenersCount(0);

      const {
        unsubscribeNotes,
        unsubscribeNotebooks,
        unsubscribeSettings,
        unsubscribeTeamSpaces,
        unsubscribeActivity,
        unsubscribeNotifications,
        unsubscribeReminders,
        unsubscribeSharedNotes,
        unsubscribeSharedNotebooks
      } = get();

      if (unsubscribeNotes) { try { unsubscribeNotes(); } catch {} }
      if (unsubscribeNotebooks) { try { unsubscribeNotebooks(); } catch {} }
      if (unsubscribeSettings) { try { unsubscribeSettings(); } catch {} }
      if (unsubscribeTeamSpaces) { try { unsubscribeTeamSpaces(); } catch {} }
      if (unsubscribeActivity) { try { unsubscribeActivity(); } catch {} }
      if (unsubscribeNotifications) { try { unsubscribeNotifications(); } catch {} }
      if (unsubscribeReminders) { try { unsubscribeReminders(); } catch {} }
      if (unsubscribeSharedNotes) { try { unsubscribeSharedNotes(); } catch {} }
      if (unsubscribeSharedNotebooks) { try { unsubscribeSharedNotebooks(); } catch {} }

      if (syncFeedbackTimer) {
        clearTimeout(syncFeedbackTimer);
        syncFeedbackTimer = null;
      }
      if (directorySyncTimer) {
        clearTimeout(directorySyncTimer);
        directorySyncTimer = null;
      }

      // Clear chat listeners and in-memory cache to prevent cross-account leaks
      unsubscribeActiveMessages();
      clearChatCache();
      setCurrentSpeechUser(null);

      // Save the outgoing user's workspace before clearing
      persist();

      // Broadcast auth change to other tabs so they synchronize immediately
      try {
        getTabCoordinator().broadcast({
          type: 'AUTH_CHANGED',
          senderId: getTabCoordinator().tabId,
          timestamp: Date.now(),
          payload: { uid: null }
        });
      } catch {}

      // Switch to guest workspace namespace
      setWorkspacePrefix(null);
      // Load clean guest workspace (typically empty)
      const guestData = loadWorkspaceData();
      set({
        uid: null,
        authEpoch: get().authEpoch + 1,
        notes: guestData.notes,
        notebooks: guestData.notebooks.length ? guestData.notebooks : [defaultNotebook],
        tags: guestData.tags,
        profile: defaultProfile,
        settings: defaultSettings,
        isOnboarded: false,
        scratchPad: guestData.scratchPad,
        savedSearches: guestData.savedSearches,
        teamSpaces: [],
        activityItems: [],
        notifications: [],
        reminders: [],
        syncQueue: [],
        syncConflicts: [],
        conflictRecoveryNotice: null,
        unsubscribeNotes: null,
        unsubscribeNotebooks: null,
        unsubscribeSettings: null,
        unsubscribeTeamSpaces: null,
        unsubscribeActivity: null,
        unsubscribeNotifications: null,
        unsubscribeSharedNotes: null,
        unsubscribeSharedNotebooks: null,
        unlockedNotes: {},
        currentView: 'home',
        selectedNoteId: null,
        editingNote: false,
        activeChatId: null,
        aiNoteContext: null,
        syncStatus: 'idle',
        syncMessage: '',
        lastManualSyncAt: null,
      });
      resolvedConflictIdentities.clear();
    },

    scratchPad: initialData.scratchPad,

    // ── Profile ──
    setProfile: (updates) => {
      set(s => {
        const authenticatedEmail = normalizeEmail(auth.currentUser?.email || '');
        const profile = {
          ...s.profile,
          ...updates,
          ...(authenticatedEmail ? { email: authenticatedEmail } : {}),
        };
        if (profile.name) {
          const parts = profile.name.trim().split(' ');
          profile.initials = parts.length >= 2
            ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
            : parts[0].slice(0, 2).toUpperCase();
        }
        return { profile };
      });
      persist();

      const { uid, profile } = get();
      if (directorySyncTimer) clearTimeout(directorySyncTimer);
      if (uid && profile.email) {
        directorySyncTimer = setTimeout(() => {
          void setDoc(
            doc(db, 'users_directory', normalizeEmail(profile.email)),
            directoryRecord(profile, uid),
            { merge: true }
          ).catch(error => console.warn('Could not update collaboration directory profile:', error));
          directorySyncTimer = null;
        }, 700);
      }
    },

    completeOnboarding: (name, email, avatar) => {
      const parts = name.trim().split(' ');
      const initials = parts.length >= 2
        ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
        : parts[0].slice(0, 2).toUpperCase();
      const existingProfile = get().profile;
      const keepChosenAvatar = existingProfile.avatarSource === 'builtin' || existingProfile.avatarSource === 'custom';
      const resolvedAvatar = keepChosenAvatar
        ? (existingProfile.avatar || 'builtin:aurora')
        : (avatar || existingProfile.avatar || 'builtin:aurora');
      const avatarSource = keepChosenAvatar
        ? existingProfile.avatarSource
        : (avatar ? 'google' : existingProfile.avatarSource || 'builtin');
      const profile = { name, email: email || '', initials, avatar: resolvedAvatar, avatarSource, createdAt: now() };
      set({
        isOnboarded: true,
        profile
      });
      persist();
      if (email) {
        void setDoc(
          doc(db, 'users_directory', normalizeEmail(email)),
          directoryRecord(profile, get().uid),
          { merge: true }
        ).catch(error => console.warn('Could not register collaboration directory profile:', error));
      }
    },

    // ── Settings ──
    updateSettings: (updates) => {
      set(s => ({ settings: { ...s.settings, ...updates } }));
      persist();
      syncSettingsToFirestore();
    },
    setTheme: (theme) => {
      set(s => ({ settings: { ...s.settings, theme } }));
      persist();
      syncSettingsToFirestore();
    },
    setAccent: (accent) => {
      set(s => ({ settings: { ...s.settings, accent } }));
      persist();
      syncSettingsToFirestore();
    },
    setNoteTheme: async (id, theme) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, theme, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },
    toggleZenMode: () => {
      set(s => ({ settings: { ...s.settings, zenMode: !s.settings.zenMode } }));
      persist();
      syncSettingsToFirestore();
    },
    flushSyncQueue: flushQueuedSync,
    manualSync: async () => {
      const initialState = get();
      if (!initialState.uid) {
        const message = 'Sign in to sync this app across your devices.';
        setSyncFeedback('error', message);
        throw new Error(message);
      }
      if (!initialState.online) {
        const message = "You're offline. Your changes are safe on this device and will sync when you're back online.";
        setSyncFeedback('error', message);
        throw new Error(message);
      }
      const activeManualSync = manualSyncInFlight;
      if (activeManualSync && activeManualSync.uid === initialState.uid) return activeManualSync.promise;
      if (activeManualSync) {
        const message = 'A sync for the previous account is still finishing. Please try again in a moment.';
        setSyncFeedback('error', message);
        throw new Error(message);
      }

      const syncUid = initialState.uid;
      const ensureSameSession = () => {
        if (get().uid !== syncUid) {
          throw new Error('Sync stopped because the signed-in account changed.');
        }
      };

      const operation = (async () => {
        ensureSameSession();

        if (syncFeedbackTimer) {
          clearTimeout(syncFeedbackTimer);
          syncFeedbackTimer = null;
        }
        set({ syncStatus: 'syncing', syncMessage: 'Syncing local changes with the cloud...' });

        const syncStartTime = performance.now();
        try {
          queueDebouncedNoteEdits();
          const queuedBefore = get().syncQueue.length;
          await withTimeout(
            flushQueuedSync(),
            MANUAL_SYNC_TIMEOUT_MS,
            'Uploading changes took too long. They remain queued and automatic sync will retry.'
          );
          ensureSameSession();
          await withTimeout(
            waitForPendingWrites(db),
            MANUAL_SYNC_TIMEOUT_MS,
            'Cloud confirmation took too long. Automatic sync will keep trying in the background.'
          );
          ensureSameSession();

          // Truthful sync: Also request offline media draining
          const mediaSyncService = getOfflineMediaSyncService();
          const mediaResult = await mediaSyncService.requestSyncFromLeader(syncUid).catch(async () => {
            // §40: On media sync/delegation failure, query actual local pending count.
            // Never translate unknown failure into 0 pending.
            try {
              const allPending = await getPendingMediaForUser(syncUid, false);
              return summarizePendingMedia(allPending, 0, 0);
            } catch {
              return {
                synced: 0,
                failed: 0,
                pendingCount: -1,
                pendingTotal: -1,
                eligibleNow: 0,
                waitingForBackoff: 0,
                needsAttention: 0,
                authPaused: 0,
              }; // -1 signals unknown
            }
          });
          ensureSameSession();

          const currentState = get();
          const remainingDocChanges = currentState.syncQueue.length;
          const remainingMedia = mediaResult.pendingTotal >= 0 ? mediaResult.pendingTotal : mediaResult.pendingCount;
          const conflicts = currentState.syncConflicts.length;
          const conflictIds = new Set(currentState.syncConflicts.map(conflict => conflict.noteId));
          const blockedByConflicts = currentState.syncQueue.filter(item =>
            (item.entityType || 'note') === 'note' && conflictIds.has(item.noteId)
          ).length;
          const failedDocChanges = Math.max(0, remainingDocChanges - blockedByConflicts);
          const syncedChanges = Math.max(0, queuedBefore - remainingDocChanges) + mediaResult.synced;
          const syncedAt = now();

          if (failedDocChanges > 0 || mediaResult.failed > 0) {
            const failCount = failedDocChanges + mediaResult.failed;
            throw new Error(`${failCount} change${failCount === 1 ? '' : 's'} could not reach the cloud yet. They remain queued for retry.`);
          }

          set({ lastManualSyncAt: syncedAt });
          if (conflicts > 0) {
            setSyncFeedback(
              'attention',
              `Available changes synced. ${conflicts} conflict${conflicts === 1 ? '' : 's'} still need review.`
            );
          } else if (remainingMedia > 0) {
            if (mediaResult.needsAttention > 0) {
              setSyncFeedback(
                'attention',
                'Your notes are synced. Some files need attention before they can upload.'
              );
            } else {
              setSyncFeedback(
                'attention',
                'Your notes are synced. Some files are waiting to upload and will retry automatically.'
              );
            }
          } else {
            setSyncFeedback(
              'success',
              'Everything is up to date.'
            );
          }

          if (syncUid) {
            void retryPendingMediaCleanups(syncUid).catch(() => 0);
            void retryPendingReminderCleanups(syncUid).catch(() => 0);
          }

          recordManualSyncMetrics(performance.now() - syncStartTime, 'success');
          return {
            queuedBefore,
            syncedChanges,
            remainingChanges: remainingDocChanges + Math.max(0, remainingMedia),
            conflicts,
            syncedAt,
            mediaDetails: {
              pendingTotal: mediaResult.pendingTotal,
              waitingForBackoff: mediaResult.waitingForBackoff,
              needsAttention: mediaResult.needsAttention,
              eligibleNow: mediaResult.eligibleNow,
              authPaused: mediaResult.authPaused,
            },
          };
        } catch (error) {
          recordManualSyncMetrics(performance.now() - syncStartTime, 'error');
          const message = error instanceof Error ? error.message : 'Sync could not finish. Your changes remain saved on this device.';
          if (get().uid === syncUid) setSyncFeedback('error', message);
          throw error;
        }
      });

      const trackedOperation = operation().finally(() => {
        if (manualSyncInFlight?.promise === trackedOperation) manualSyncInFlight = null;
      });
      manualSyncInFlight = { uid: syncUid, promise: trackedOperation };
      return trackedOperation;
    },
    resolveSyncConflict: async (conflictId, strategy, conflictOverride) => {
      const conflict = conflictOverride || get().syncConflicts.find(item => item.id === conflictId);
      if (!conflict) return;

      const currentUid = get().uid;
      const cleanTitle = (conflict.local.title || 'Untitled').replace(/\s*\(Recovered Copy\)$/, '');

      // Explicit legacy strategies for backward compatibility
      if (strategy === 'keep_deleted') {
        set(s => ({
          notes: s.notes.filter(n => n.id !== conflict.noteId),
          tags: rebuildTags(s.notes.filter(n => n.id !== conflict.noteId)),
          syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
          syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
        }));
        persist();
        return;
      }

      if (strategy === 'recover_version') {
        const newId = uuid();
        const recoveredCopy: Note = {
          ...conflict.local,
          id: newId,
          ownerId: currentUid || conflict.local.ownerId,
          isShared: false,
          isPublished: false,
          shareAccess: undefined,
          sharedWith: undefined,
          editors: undefined,
          commenters: undefined,
          viewers: undefined,
          sharedBy: undefined,
          title: `${cleanTitle} (Recovered Copy)`,
          createdAt: now(),
          updatedAt: now(),
        };

        set(s => {
          const notesWithoutOriginal = s.notes.filter(n => n.id !== conflict.noteId);
          const updatedNotes = [...notesWithoutOriginal, recoveredCopy];
          return {
            notes: updatedNotes,
            tags: rebuildTags(updatedNotes),
            syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
            syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
            conflictRecoveryNotice: {
              id: uuid(),
              conflictId: conflict.id,
              type: 'remote_deletion',
              title: 'Your edits are safe',
              message: 'This note was deleted on another device, so we saved your unsynced edits as a new note.',
              recoveredNoteId: recoveredCopy.id,
              canonicalNoteId: null,
              recoveredNote: recoveredCopy,
              localTitle: conflict.local.title,
              localContent: conflict.local.content,
              detectedAt: now(),
            },
          };
        });
        persist();
        syncNoteToFirestore(recoveredCopy.id);
        get().selectNote(recoveredCopy.id);
        return;
      }

      if (strategy === 'keep_local' || strategy === 'local') {
        set(s => {
          const updatedNotes = s.notes.map(n => n.id === conflict.noteId ? conflict.local : n);
          return {
            notes: updatedNotes,
            tags: rebuildTags(updatedNotes),
            syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
          };
        });
        persist();
        syncNoteToFirestore(conflict.noteId);
        return;
      }

      if (strategy === 'use_remote' || strategy === 'remote') {
        if (conflict.remote) {
          set(s => {
            const updatedNotes = s.notes.map(n => n.id === conflict.noteId ? conflict.remote! : n);
            return {
              notes: updatedNotes,
              tags: rebuildTags(updatedNotes),
              syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
              syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
            };
          });
          persist();
        }
        return;
      }

      if (strategy === 'keep_both' && conflict.remote) {
        const localCopy: Note = {
          ...conflict.local,
          id: uuid(),
          ownerId: currentUid || conflict.local.ownerId,
          isShared: false,
          isPublished: false,
          shareAccess: undefined,
          sharedWith: undefined,
          editors: undefined,
          commenters: undefined,
          viewers: undefined,
          sharedBy: undefined,
          title: `${cleanTitle} (Recovered Copy)`,
          createdAt: now(),
          updatedAt: now(),
        };
        set(s => {
          const updatedNotes = s.notes.map(n => n.id === conflict.noteId ? (conflict.remote || n) : n);
          return {
            notes: [...updatedNotes, localCopy],
            tags: rebuildTags([...updatedNotes, localCopy]),
            syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
            syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
          };
        });
        persist();
        syncNoteToFirestore(localCopy.id);
        get().selectNote(localCopy.id);
        return;
      }

      // NOVICE-FIRST AUTOMATIC SAFE RECOVERY (Default / 'auto_safe')
      // Rule 1: Remote Deletion Conflict
      if (conflict.deletedRemotely) {
        const identityKey = getConflictIdentity(conflict);
        if (resolvedConflictIdentities.has(identityKey)) {
          set(s => ({
            syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
            syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
          }));
          persist();
          return;
        }
        resolvedConflictIdentities.add(identityKey);

        const newId = uuid();
        const recoveredCopy: Note = {
          ...conflict.local,
          id: newId,
          ownerId: currentUid || conflict.local.ownerId,
          isShared: false,
          isPublished: false,
          shareAccess: undefined,
          sharedWith: undefined,
          editors: undefined,
          commenters: undefined,
          viewers: undefined,
          sharedBy: undefined,
          title: `${cleanTitle} (Recovered Copy)`,
          createdAt: now(),
          updatedAt: now(),
        };

        set(s => {
          const notesWithoutOriginal = s.notes.filter(n => n.id !== conflict.noteId);
          const updatedNotes = [...notesWithoutOriginal, recoveredCopy];
          return {
            notes: updatedNotes,
            tags: rebuildTags(updatedNotes),
            syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
            syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
            conflictRecoveryNotice: {
              id: uuid(),
              conflictId: conflict.id,
              type: 'remote_deletion',
              title: 'Your edits are safe',
              message: 'This note was deleted on another device, so we saved your unsynced edits as a new note.',
              recoveredNoteId: recoveredCopy.id,
              canonicalNoteId: null,
              recoveredNote: recoveredCopy,
              localTitle: conflict.local.title,
              localContent: conflict.local.content,
              detectedAt: now(),
            },
          };
        });
        persist();
        syncNoteToFirestore(recoveredCopy.id);
        get().selectNote(recoveredCopy.id);
        return;
      }

      // Rule 2: Standard Concurrent Edit Conflict
      if (conflict.remote) {
        // Section 10: If local and remote user-visible content are identical, resolve silently
        if (!hasMeaningfulNoteDifference(conflict.local, conflict.remote)) {
          set(s => {
            const updatedNotes = s.notes.map(n => n.id === conflict.noteId ? conflict.remote! : n);
            return {
              notes: updatedNotes,
              tags: rebuildTags(updatedNotes),
              syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
              syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
            };
          });
          persist();
          return;
        }

        // Section 9: Idempotency guard - prevent duplicate recovered copies
        const identityKey = getConflictIdentity(conflict);
        if (resolvedConflictIdentities.has(identityKey)) {
          set(s => ({
            syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
            syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
          }));
          persist();
          return;
        }
        resolvedConflictIdentities.add(identityKey);

        // Section 5 & 6: Preserve remote as existing canonical note; fork local edits to new private note
        const newId = uuid();
        const recoveredCopy: Note = {
          ...conflict.local,
          id: newId,
          ownerId: currentUid || conflict.local.ownerId,
          isShared: false,
          isPublished: false,
          shareAccess: undefined,
          sharedWith: undefined,
          editors: undefined,
          commenters: undefined,
          viewers: undefined,
          sharedBy: undefined,
          title: `${cleanTitle} (Recovered Copy)`,
          createdAt: now(),
          updatedAt: now(),
        };

        set(s => {
          const updatedNotes = s.notes.map(n => n.id === conflict.noteId ? conflict.remote! : n);
          const combinedNotes = [...updatedNotes, recoveredCopy];
          return {
            notes: combinedNotes,
            tags: rebuildTags(combinedNotes),
            syncConflicts: s.syncConflicts.filter(item => item.id !== conflictId),
            syncQueue: s.syncQueue.filter(item => item.noteId !== conflict.noteId),
            conflictRecoveryNotice: {
              id: uuid(),
              conflictId: conflict.id,
              type: 'concurrent_edit',
              title: 'Your edits are safe',
              message: 'This note also changed on another device, so NTK Note saved your edits as a separate copy. Nothing was lost.',
              recoveredNoteId: recoveredCopy.id,
              canonicalNoteId: conflict.remote!.id,
              recoveredNote: recoveredCopy,
              canonicalNote: conflict.remote,
              localTitle: conflict.local.title,
              remoteTitle: conflict.remote!.title,
              localContent: conflict.local.content,
              remoteContent: conflict.remote!.content,
              detectedAt: now(),
            },
          };
        });
        persist();
        syncNoteToFirestore(recoveredCopy.id);
        get().selectNote(recoveredCopy.id);
        return;
      }
    },
    setOnlineStatus: (online) => {
      set({ online });
      if (online) {
        void flushQueuedSync();
        const currentUid = get().uid;
        if (currentUid) {
          void retryPendingMediaCleanups(currentUid).catch(() => 0);
          void retryPendingReminderCleanups(currentUid).catch(() => 0);
        }
      }
    },

    // ── Notifications ──
    addNotification: (input) => {
      let result: AppNotification = {
        ...input,
        id: input.id || uuid(),
        createdAt: input.createdAt || now(),
        priority: input.priority || 'normal',
        deliveryCount: input.deliveryCount || 0,
      };

      set(s => {
        const existing = s.notifications.find(notification => notification.id === result.id);
        const nextNotification = existing
          ? {
              ...existing,
              ...result,
              readAt: existing.readAt,
              dismissedAt: existing.dismissedAt,
              snoozedUntil: existing.snoozedUntil,
              lastDeliveredAt: existing.lastDeliveredAt,
              deliveryCount: existing.deliveryCount,
            }
          : result;

        result = nextNotification;

        return {
          notifications: capNotifications(existing
            ? s.notifications.map(notification => notification.id === nextNotification.id ? nextNotification : notification)
            : [nextNotification, ...s.notifications]),
        };
      });
      persist();
      syncNotificationToFirestore(result.id);
      return result;
    },

    markNotificationRead: (id) => {
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id || notification.readAt) return notification;
          changed = true;
          return { ...notification, readAt: now() };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    markAllNotificationsRead: () => {
      const timestamp = now();
      const changedIds: string[] = [];
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.readAt || notification.dismissedAt) return notification;
          changedIds.push(notification.id);
          return { ...notification, readAt: timestamp };
        }),
      }));
      if (changedIds.length) {
        persist();
        changedIds.forEach(id => syncNotificationToFirestore(id));
      }
    },

    dismissNotification: (id) => {
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id || notification.dismissedAt) return notification;
          changed = true;
          return {
            ...notification,
            readAt: notification.readAt || now(),
            dismissedAt: now(),
            snoozedUntil: undefined,
          };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    snoozeNotification: (id, minutes) => {
      const timestamp = new Date(Date.now() + Math.max(minutes, 1) * 60 * 1000).toISOString();
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id) return notification;
          changed = true;
          return {
            ...notification,
            readAt: notification.readAt || now(),
            dismissedAt: undefined,
            snoozedUntil: timestamp,
          };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    recordNotificationDelivery: (id) => {
      let changed = false;
      set(s => ({
        notifications: s.notifications.map(notification => {
          if (notification.id !== id) return notification;
          changed = true;
          return {
            ...notification,
            lastDeliveredAt: now(),
            deliveryCount: (notification.deliveryCount || 0) + 1,
            snoozedUntil: undefined,
          };
        }),
      }));
      if (changed) {
        persist();
        syncNotificationToFirestore(id);
      }
    },

    clearDismissedNotifications: () => {
      const dismissedIds = get().notifications
        .filter(notification => notification.dismissedAt)
        .map(notification => notification.id);

      if (!dismissedIds.length) return;
      set(s => ({
        notifications: s.notifications.filter(notification => !notification.dismissedAt),
      }));
      persist();
      dismissedIds.forEach(id => deleteNotificationFromFirestore(id));
    },

    // ── Reminders ──
    createReminder: async (input) => {
      const { uid } = get();
      const id = uuid();
      const createdAt = now();
      const updatedAt = createdAt;
      const reminder: AppReminder = {
        id,
        ownerId: uid || undefined,
        noteId: input.noteId,
        title: input.title.trim(),
        details: input.details?.trim() || undefined,
        dueAt: input.dueAt,
        priority: input.priority,
        status: input.status || 'active',
        triggered: false,
        createdAt,
        updatedAt,
      };

      set(s => {
        const nextReminders = [reminder, ...s.reminders];
        let nextNotes = s.notes;
        if (input.noteId) {
          nextNotes = s.notes.map(n => n.id === input.noteId ? {
            ...n,
            reminder: {
              id,
              noteId: input.noteId!,
              time: input.dueAt,
              title: input.title.trim(),
              triggered: false,
            },
            updatedAt,
          } : n);
        }
        return { reminders: nextReminders, notes: nextNotes };
      });
      persist();
      syncReminderToFirestore(id);
      if (input.noteId) {
        syncNoteToFirestore(input.noteId);
      }
      return reminder;
    },

    updateReminder: async (id, updates) => {
      const updatedAt = now();
      const current = get().reminders.find(r => r.id === id);
      if (!current) return;
      const updated: AppReminder = {
        ...current,
        ...updates,
        updatedAt,
      };

      set(s => {
        const nextReminders = s.reminders.map(r => r.id === id ? updated : r);
        let nextNotes = s.notes;
        if (updated.noteId) {
          nextNotes = s.notes.map(n => n.id === updated.noteId ? {
            ...n,
            reminder: updated.status === 'active' ? {
              id: updated.id,
              noteId: updated.noteId!,
              time: updated.dueAt,
              title: updated.title,
              triggered: !!updated.triggered,
            } : undefined,
            updatedAt,
          } : n);
        }
        return { reminders: nextReminders, notes: nextNotes };
      });
      persist();
      syncReminderToFirestore(id);
      if (updated.noteId) {
        syncNoteToFirestore(updated.noteId);
      }
    },

    deleteReminder: async (id) => {
      const current = get().reminders.find(r => r.id === id);
      set(s => {
        const nextReminders = s.reminders.filter(r => r.id !== id);
        let nextNotes = s.notes;
        if (current?.noteId) {
          nextNotes = s.notes.map(n => n.id === current.noteId ? {
            ...n,
            reminder: undefined,
            updatedAt: now(),
          } : n);
        }
        return { reminders: nextReminders, notes: nextNotes };
      });
      persist();
      deleteReminderFromFirestore(id);
      if (current?.noteId) {
        syncNoteToFirestore(current.noteId);
      }
    },

    toggleReminderStatus: async (id) => {
      const current = get().reminders.find(r => r.id === id);
      if (!current) return;
      const nextStatus: ReminderStatus = current.status === 'completed' ? 'active' : 'completed';
      await get().updateReminder(id, {
        status: nextStatus,
        triggered: nextStatus === 'completed' ? true : current.triggered,
      });
    },

    snoozeReminderItem: async (id, option) => {
      const snoozedUntil = calculateSnoozeTime(option);
      await get().updateReminder(id, {
        snoozedUntil,
        triggered: false,
        status: 'active',
      });
    },

    getAllReminders: () => {
      return get().reminders;
    },

    // ── Notes ──
    createNote: (partial) => {
      const id = uuid();
      const cleanPartial = definedOnly(partial as Record<string, unknown>) as Partial<Note>;
      const note: Note = {
        id,
        title: '',
        content: '',
        color: 'default',
        tags: [],
        pinned: false,
        starred: false,
        archived: false,
        trashed: false,
        locked: false,
        checklist: [],
        priority: null,
        createdAt: now(),
        updatedAt: now(),
        wordCount: 0,
        charCount: 0,
        linkedNoteIds: [],
        order: 0,
        ...cleanPartial,
        type: cleanPartial.type || get().settings.defaultNoteType,
        theme: cleanPartial.theme || get().settings.defaultNoteTheme,
        notebookId: cleanPartial.notebookId || get().settings.defaultNotebook,
      };
      set(s => {
        const notes = [note, ...s.notes];
        return { notes, tags: rebuildTags(notes), selectedNoteId: note.id, editingNote: true };
      });
      persist();
      syncNoteToFirestore(id);
      return Promise.resolve(note);
    },

    updateNote: async (id, updates, immediateSync = false) => {
      let activityMessage = '';
      let activityShared = false;
      let activityParticipants: string[] = [];
      let baseUpdatedAt: string | undefined;
      set(s => {
        const existing = s.notes.find(n => n.id === id);
        if (existing) {
          const queued = s.syncQueue.find(q => q.noteId === id && (q.entityType || 'note') === 'note');
          baseUpdatedAt = queued?.baseUpdatedAt || existing.updatedAt;
        }
        const notes = s.notes.map(n => {
          if (n.id !== id) return n;
          const updated = { ...n, ...updates, updatedAt: now() };
          if (updates.content !== undefined || updates.title !== undefined) {
            const fullText = (updates.title ?? n.title) + ' ' + (updates.content ?? n.content);
            updated.wordCount = countWords(fullText);
            updated.charCount = countChars(updates.content ?? n.content);
          }
          if (updated.isShared) {
            const isTextEdit = updates.title !== undefined || updates.content !== undefined;
            const throttleKey = `edit-${id}`;
            const canLogTextEdit = !isTextEdit || Date.now() - (activityThrottle[throttleKey] || 0) > 5 * 60 * 1000;
            if (canLogTextEdit) {
              activityThrottle[throttleKey] = Date.now();
              activityShared = true;
              activityParticipants = getEntityParticipants(updated, updated.sharedBy || s.profile.email);
              if (updates.notebookId !== undefined) activityMessage = `Moved ${updated.title || 'Untitled note'} to another notebook.`;
              else if (updates.archived !== undefined) activityMessage = `${updates.archived ? 'Archived' : 'Unarchived'} ${updated.title || 'Untitled note'}.`;
              else if (updates.trashed !== undefined) activityMessage = `${updates.trashed ? 'Moved' : 'Restored'} ${updated.title || 'Untitled note'} ${updates.trashed ? 'to trash' : 'from trash'}.`;
              else activityMessage = `Edited ${updated.title || 'Untitled note'}.`;
            }
          }
          return updated;
        });
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      const isTextEdit = updates.title !== undefined || updates.content !== undefined;
      syncNoteToFirestore(id, (isTextEdit && !immediateSync) ? 5000 : 0, baseUpdatedAt);
      if (activityShared && activityMessage) {
        void get().addActivity({
          entityType: 'note',
          entityId: id,
          noteId: id,
          action: 'note-updated',
          message: activityMessage,
          participants: activityParticipants,
          shared: true,
        });
      }
    },

    deleteNote: async (id) => {
      const { notes, notebooks, reminders, uid } = get();
      const plan = buildDeletionPlan({
        allNotes: notes,
        allNotebooks: notebooks,
        allReminders: reminders,
        targetNoteIds: [id],
        currentUserId: uid,
      });

      const result = await executePermanentDeletion(plan, { currentUserId: uid });

      if (result.deletedNoteIds.length > 0) {
        const deletedSet = new Set(result.deletedNoteIds);
        set(s => {
          const remainingNotes = s.notes.filter(n => !deletedSet.has(n.id));
          return {
            notes: remainingNotes,
            tags: rebuildTags(remainingNotes),
            selectedNoteId: deletedSet.has(s.selectedNoteId || '') ? null : s.selectedNoteId,
            editingNote: deletedSet.has(s.selectedNoteId || '') ? false : s.editingNote,
            aiNoteContext: s.aiNoteContext && deletedSet.has(s.aiNoteContext.noteId) ? null : s.aiNoteContext,
          };
        });
        persist();
      }

      if (result.deletedReminderIds?.length > 0) {
        const deletedReminderSet = new Set(result.deletedReminderIds);
        set(s => ({
          reminders: s.reminders.filter(r => !deletedReminderSet.has(r.id)),
        }));
        persist();
      }

      if (result.staleSkippedNoteIds?.length > 0) {
        const staleSet = new Set(result.staleSkippedNoteIds);
        set(s => ({
          notes: s.notes.map(n => staleSet.has(n.id) ? { ...n, trashed: false, trashedAt: undefined } : n),
        }));
        persist();
      }

      return result;
    },

    bulkDeleteNotes: async (ids) => {
      const { notes, notebooks, reminders, uid } = get();
      const plan = buildDeletionPlan({
        allNotes: notes,
        allNotebooks: notebooks,
        allReminders: reminders,
        targetNoteIds: ids,
        currentUserId: uid,
      });

      const result = await executePermanentDeletion(plan, { currentUserId: uid });

      if (result.deletedNoteIds.length > 0) {
        const deletedSet = new Set(result.deletedNoteIds);
        set(s => {
          const remainingNotes = s.notes.filter(n => !deletedSet.has(n.id));
          return {
            notes: remainingNotes,
            tags: rebuildTags(remainingNotes),
            selectedNoteId: deletedSet.has(s.selectedNoteId || '') ? null : s.selectedNoteId,
            editingNote: deletedSet.has(s.selectedNoteId || '') ? false : s.editingNote,
            aiNoteContext: s.aiNoteContext && deletedSet.has(s.aiNoteContext.noteId) ? null : s.aiNoteContext,
          };
        });
        persist();
      }

      if (result.deletedReminderIds?.length > 0) {
        const deletedReminderSet = new Set(result.deletedReminderIds);
        set(s => ({
          reminders: s.reminders.filter(r => !deletedReminderSet.has(r.id)),
        }));
        persist();
      }

      if (result.staleSkippedNoteIds?.length > 0) {
        const staleSet = new Set(result.staleSkippedNoteIds);
        set(s => ({
          notes: s.notes.map(n => staleSet.has(n.id) ? { ...n, trashed: false, trashedAt: undefined } : n),
        }));
        persist();
      }

      return result;
    },

    trashNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? { ...n, trashed: true, trashedAt: now(), pinned: false } : n
        );
        return {
          notes,
          tags: rebuildTags(notes),
          selectedNoteId: s.selectedNoteId === id ? null : s.selectedNoteId,
          editingNote: s.selectedNoteId === id ? false : s.editingNote,
        };
      });
      persist();
      syncNoteToFirestore(id);
    },

    bulkTrashNotes: async (ids) => {
      set(s => {
        const notes = s.notes.map(n =>
          ids.includes(n.id) ? { ...n, trashed: true, trashedAt: now(), pinned: false } : n
        );
        return {
          notes,
          tags: rebuildTags(notes),
          selectedNoteId: ids.includes(s.selectedNoteId || '') ? null : s.selectedNoteId,
          editingNote: ids.includes(s.selectedNoteId || '') ? false : s.editingNote,
        };
      });
      persist();
      ids.forEach(id => syncNoteToFirestore(id));
    },

    restoreNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? {
            ...n,
            trashed: false,
            trashedAt: undefined,
            ...(s.notebooks.some(nb => nb.id === n.notebookId && nb.trashed)
              ? { notebookId: 'default', sectionId: undefined }
              : {}),
          } : n
        );
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(id);
    },

    emptyTrash: async () => {
      const { notes, notebooks, reminders, uid } = get();
      const plan = buildDeletionPlan({
        allNotes: notes,
        allNotebooks: notebooks,
        allReminders: reminders,
        currentUserId: uid,
      });

      const result = await executePermanentDeletion(plan, { currentUserId: uid });

      if (result.deletedNoteIds.length > 0 || result.deletedNotebookIds.length > 0 || result.reparentedNoteIds.length > 0 || result.reparentedNotebookIds.length > 0) {
        const deletedNoteSet = new Set(result.deletedNoteIds);
        const deletedNbSet = new Set(result.deletedNotebookIds);
        const reparentedSet = new Set(result.reparentedNoteIds);
        const reparentedNbSet = new Set(result.reparentedNotebookIds);

        set(s => {
          const remainingNotes = s.notes
            .filter(n => !deletedNoteSet.has(n.id))
            .map(n => reparentedSet.has(n.id) ? { ...n, notebookId: 'default', sectionId: undefined } : n);
          const remainingNotebooks = s.notebooks
            .filter(nb => !deletedNbSet.has(nb.id))
            .map(nb => reparentedNbSet.has(nb.id) ? { ...nb, parentId: null } : nb);
          return {
            notes: remainingNotes,
            tags: rebuildTags(remainingNotes),
            notebooks: remainingNotebooks,
            selectedNoteId: deletedNoteSet.has(s.selectedNoteId || '') ? null : s.selectedNoteId,
            editingNote: deletedNoteSet.has(s.selectedNoteId || '') ? false : s.editingNote,
            selectedNotebookId: deletedNbSet.has(s.selectedNotebookId || '') ? null : s.selectedNotebookId,
            aiNoteContext: s.aiNoteContext && deletedNoteSet.has(s.aiNoteContext.noteId) ? null : s.aiNoteContext,
          };
        });
        persist();
      }

      if (result.deletedReminderIds?.length > 0) {
        const deletedReminderSet = new Set(result.deletedReminderIds);
        set(s => ({
          reminders: s.reminders.filter(r => !deletedReminderSet.has(r.id)),
        }));
        persist();
      }

      if (result.staleSkippedNoteIds?.length > 0) {
        const staleSet = new Set(result.staleSkippedNoteIds);
        set(s => ({
          notes: s.notes.map(n => staleSet.has(n.id) ? { ...n, trashed: false, trashedAt: undefined } : n),
        }));
        persist();
      }

      if (result.staleSkippedNotebookIds?.length > 0) {
        const staleNbSet = new Set(result.staleSkippedNotebookIds);
        set(s => ({
          notebooks: s.notebooks.map(nb => staleNbSet.has(nb.id) ? { ...nb, trashed: false, trashedAt: undefined } : nb),
        }));
        persist();
      }

      return result;
    },

    restoreAll: async () => {
      const { notes, notebooks, uid } = get();
      const trashedNotes = notes.filter(n => n.trashed);
      const trashedNotebooks = notebooks.filter(nb => nb.trashed);
      if (trashedNotes.length === 0 && trashedNotebooks.length === 0) return;

      const validNotebookIds = new Set(notebooks.map(nb => nb.id));

      set(s => {
        const nextNotebooks = s.notebooks.map(nb =>
          nb.trashed ? { ...nb, trashed: false, trashedAt: undefined } : nb
        );
        const nextNotes = s.notes.map(n => {
          if (!n.trashed) return n;
          const notebookExists = validNotebookIds.has(n.notebookId);
          return {
            ...n,
            trashed: false,
            trashedAt: undefined,
            notebookId: notebookExists ? n.notebookId : 'default',
            sectionId: notebookExists ? n.sectionId : undefined,
          };
        });

        return {
          notebooks: nextNotebooks,
          notes: nextNotes,
          tags: rebuildTags(nextNotes),
        };
      });
      persist();

      if (uid) {
        trashedNotebooks.forEach(nb => syncNotebookToFirestore(nb.id));
        trashedNotes.forEach(n => syncNoteToFirestore(n.id));
      }
    },

    cleanupTrashOlderThan: async (days) => {
      const cutoff = Date.now() - Math.max(0, days) * 24 * 60 * 60 * 1000;
      const { notes, notebooks, reminders, uid } = get();
      const expiredNotes = notes.filter(n =>
        n.trashed &&
        n.trashedAt &&
        new Date(n.trashedAt).getTime() <= cutoff
      );
      const expiredNotebooks = notebooks.filter(nb =>
        nb.trashed &&
        nb.trashedAt &&
        new Date(nb.trashedAt).getTime() <= cutoff
      );

      if (expiredNotes.length === 0 && expiredNotebooks.length === 0) {
        return { notes: 0, notebooks: 0 };
      }

      const plan = buildDeletionPlan({
        allNotes: notes,
        allNotebooks: notebooks,
        allReminders: reminders,
        targetNoteIds: expiredNotes.map(n => n.id),
        targetNotebookIds: expiredNotebooks.map(nb => nb.id),
        currentUserId: uid,
      });

      const result = await executePermanentDeletion(plan, { currentUserId: uid });

      if (result.deletedNoteIds.length > 0 || result.deletedNotebookIds.length > 0 || result.reparentedNoteIds.length > 0 || result.reparentedNotebookIds.length > 0) {
        const deletedNoteSet = new Set(result.deletedNoteIds);
        const deletedNbSet = new Set(result.deletedNotebookIds);
        const reparentedSet = new Set(result.reparentedNoteIds);
        const reparentedNbSet = new Set(result.reparentedNotebookIds);

        set(s => {
          const remainingNotes = s.notes
            .filter(n => !deletedNoteSet.has(n.id))
            .map(n => reparentedSet.has(n.id) ? { ...n, notebookId: 'default', sectionId: undefined } : n);
          const remainingNotebooks = s.notebooks
            .filter(nb => !deletedNbSet.has(nb.id))
            .map(nb => reparentedNbSet.has(nb.id) ? { ...nb, parentId: null } : nb);
          return {
            notes: remainingNotes,
            tags: rebuildTags(remainingNotes),
            notebooks: remainingNotebooks,
            selectedNoteId: deletedNoteSet.has(s.selectedNoteId || '') ? null : s.selectedNoteId,
            editingNote: deletedNoteSet.has(s.selectedNoteId || '') ? false : s.editingNote,
            selectedNotebookId: deletedNbSet.has(s.selectedNotebookId || '') ? null : s.selectedNotebookId,
            aiNoteContext: s.aiNoteContext && deletedNoteSet.has(s.aiNoteContext.noteId) ? null : s.aiNoteContext,
          };
        });
        persist();
      }

      if (result.deletedReminderIds?.length > 0) {
        const deletedReminderSet = new Set(result.deletedReminderIds);
        set(s => ({
          reminders: s.reminders.filter(r => !deletedReminderSet.has(r.id)),
        }));
        persist();
      }

      return { notes: result.deletedNoteIds.length, notebooks: result.deletedNotebookIds.length };
    },

    archiveNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? { ...n, archived: true, pinned: false } : n
        );
        return {
          notes,
          selectedNoteId: s.selectedNoteId === id ? null : s.selectedNoteId,
        };
      });
      persist();
      syncNoteToFirestore(id);
    },

    unarchiveNote: async (id) => {
      set(s => {
        const notes = s.notes.map(n =>
          n.id === id ? { ...n, archived: false } : n
        );
        return { notes };
      });
      persist();
      syncNoteToFirestore(id);
    },

    pinNote: async (id) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    starNote: async (id) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, starred: !n.starred } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    duplicateNote: (id) => {
      const note = get().notes.find(n => n.id === id);
      if (!note) return Promise.resolve(null);
      const dup: Note = {
        ...note,
        id: uuid(),
        title: note.title + ' (Copy)',
        pinned: false,
        createdAt: now(),
        updatedAt: now(),
      };
      set(s => {
        const notes = [dup, ...s.notes];
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(dup.id);
      return Promise.resolve(dup);
    },

    moveNote: async (noteId, notebookId) => {
      const previous = get().notes.find(n => n.id === noteId);
      set(s => ({
        notes: s.notes.map(n => n.id === noteId ? { ...n, notebookId, sectionId: undefined, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(noteId);
      const updated = get().notes.find(n => n.id === noteId);
      if (updated?.isShared && previous?.notebookId !== notebookId) {
        const targetNotebook = get().notebooks.find(nb => nb.id === notebookId);
        void get().addActivity({
          entityType: 'note',
          entityId: noteId,
          noteId,
          notebookId,
          action: 'note-moved',
          message: `Moved ${updated.title || 'Untitled note'} to ${targetNotebook?.name || 'another notebook'}.`,
          participants: getEntityParticipants(updated, updated.sharedBy || get().profile.email),
          shared: true,
        });
      }
    },

    setNoteColor: async (id, color) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, color, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    setNotePriority: async (id, priority) => {
      set(s => ({
        notes: s.notes.map(n => n.id === id ? { ...n, priority, updatedAt: now() } : n)
      }));
      persist();
      syncNoteToFirestore(id);
    },

    addNoteTag: async (noteId, tag) => {
      set(s => {
        const notes = s.notes.map(n => {
          if (n.id !== noteId || n.tags.includes(tag)) return n;
          return { ...n, tags: [...n.tags, tag], updatedAt: now() };
        });
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(noteId);
    },

    removeNoteTag: async (noteId, tag) => {
      set(s => {
        const notes = s.notes.map(n => {
          if (n.id !== noteId) return n;
          return { ...n, tags: n.tags.filter(t => t !== tag), updatedAt: now() };
        });
        return { notes, tags: rebuildTags(notes) };
      });
      persist();
      syncNoteToFirestore(noteId);
    },

    setNoteReminder: async (noteId, reminder) => {
      const { uid } = get();
      const reminderId = reminder?.id || `reminder-note-${noteId}`;
      set(s => {
        const notes = s.notes.map(n => n.id === noteId ? { ...n, reminder, updatedAt: now() } : n);
        let reminders = [...s.reminders];
        const existingIdx = reminders.findIndex(r => r.id === reminderId || r.noteId === noteId);

        if (reminder) {
          const reminderItem: AppReminder = {
            id: reminderId,
            ownerId: uid || undefined,
            noteId,
            title: reminder.title || 'Note reminder',
            dueAt: reminder.time,
            status: 'active',
            triggered: !!reminder.triggered,
            createdAt: existingIdx >= 0 ? reminders[existingIdx].createdAt : now(),
            updatedAt: now(),
          };
          if (existingIdx >= 0) {
            reminders[existingIdx] = reminderItem;
          } else {
            reminders.push(reminderItem);
          }
        } else {
          reminders = reminders.filter(r => r.id !== reminderId && r.noteId !== noteId);
        }
        return { notes, reminders };
      });
      persist();
      syncNoteToFirestore(noteId);
      if (reminder) {
        syncReminderToFirestore(reminderId);
      } else {
        deleteReminderFromFirestore(reminderId);
      }
    },

    reorderNotes: async (noteIds) => {
      set(s => ({
        notes: s.notes.map(n => {
          const idx = noteIds.indexOf(n.id);
          return idx >= 0 ? { ...n, order: idx } : n;
        })
      }));
      persist();
      noteIds.forEach(id => syncNoteToFirestore(id));
    },

    // ── Checklist ──
    lockNote: async (noteId, password, hint = '') => {
      const note = get().notes.find(n => n.id === noteId);
      if (!note || !password.trim()) return false;
      const unlocked = get().unlockedNotes[noteId];
      const payload = await encryptNoteData({
        title: unlocked?.title ?? note.title,
        content: unlocked?.content ?? note.content,
        checklist: unlocked?.checklist ?? note.checklist,
      }, password);

      set(s => ({
        notes: s.notes.map(n => n.id === noteId ? {
          ...n,
          title: unlocked?.title ?? note.title,
          content: '',
          checklist: [],
          locked: true,
          encrypted: true,
          encryptedPayload: payload,
          lockHint: hint,
          updatedAt: now(),
        } : n),
        unlockedNotes: Object.fromEntries(Object.entries(s.unlockedNotes).filter(([id]) => id !== noteId)),
      }));
      persist();
      syncNoteToFirestore(noteId);
      return true;
    },
    unlockNote: async (noteId, password) => {
      const note = get().notes.find(n => n.id === noteId);
      if (!note?.encryptedPayload) return false;
      try {
        const data = await decryptNoteData(note.encryptedPayload, password);
        set(s => ({
          unlockedNotes: {
            ...s.unlockedNotes,
            [noteId]: {
              title: data.title,
              content: data.content,
              checklist: (data.checklist || []) as ChecklistItem[],
              password,
            },
          },
        }));
        return true;
      } catch {
        return false;
      }
    },
    relockNote: (noteId) => {
      set(s => ({
        unlockedNotes: Object.fromEntries(Object.entries(s.unlockedNotes).filter(([id]) => id !== noteId)),
      }));
    },
    updateUnlockedNote: async (noteId, updates, immediateSync = false) => {
      const unlocked = get().unlockedNotes[noteId];
      if (!unlocked) return;
      const next = { ...unlocked, ...updates };
      const payload = await encryptNoteData({
        title: next.title,
        content: next.content,
        checklist: next.checklist,
      }, next.password);
      set(s => ({
        unlockedNotes: { ...s.unlockedNotes, [noteId]: next },
        notes: s.notes.map(n => n.id === noteId ? {
          ...n,
          encryptedPayload: payload,
          updatedAt: now(),
          wordCount: countWords(`${next.title} ${next.content}`),
          charCount: countChars(next.content),
        } : n),
      }));
      persist();
      const isTextEdit = updates.title !== undefined || updates.content !== undefined;
      syncNoteToFirestore(noteId, (isTextEdit && !immediateSync) ? 5000 : 0);
    },

    addChecklistItem: async (noteId, text) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          const item: ChecklistItem = {
            id: uuid(),
            text,
            checked: false,
            order: n.checklist.length,
          };
          return { ...n, checklist: [...n.checklist, item], updatedAt: now() };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    updateChecklistItem: async (noteId, itemId, updates) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          return {
            ...n,
            checklist: n.checklist.map(i => i.id === itemId ? { ...i, ...updates } : i),
            updatedAt: now(),
          };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    removeChecklistItem: async (noteId, itemId) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          return { ...n, checklist: n.checklist.filter(i => i.id !== itemId), updatedAt: now() };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    reorderChecklist: async (noteId, itemIds) => {
      set(s => ({
        notes: s.notes.map(n => {
          if (n.id !== noteId) return n;
          return {
            ...n,
            checklist: n.checklist.map(i => {
              const idx = itemIds.indexOf(i.id);
              return idx >= 0 ? { ...i, order: idx } : i;
            }).sort((a, b) => a.order - b.order),
            updatedAt: now(),
          };
        })
      }));
      persist();
      syncNoteToFirestore(noteId);
    },

    // ── Notebooks ──
    createNotebook: (name, parentId = null, icon = '📓') => {
      const siblingCount = get().notebooks.filter(nb => nb.parentId === parentId && !nb.trashed).length;
      const nb: Notebook = {
        id: uuid(),
        name,
        parentId,
        color: 'default',
        icon,
        createdAt: now(),
        order: siblingCount,
        sections: [],
      };
      set(s => ({ notebooks: [...s.notebooks, nb] }));
      persist();
      syncNotebookToFirestore(nb.id);
      return nb;
    },

    updateNotebook: (id, updates) => {
      set(s => ({
        notebooks: s.notebooks.map(nb => nb.id === id ? { ...nb, ...updates } : nb)
      }));
      persist();
      syncNotebookToFirestore(id);
    },

    reorderNotebook: (id, parentId, targetIndex) => {
      const state = get();
      const moving = state.notebooks.find(nb => nb.id === id && !nb.trashed);
      if (!moving) return;
      if (moving.id === 'default' && parentId !== null) return;
      if (parentId === id) return;
      if (parentId && !state.notebooks.some(nb => nb.id === parentId && !nb.trashed)) return;

      const childIds = getNotebookTreeIds(id);
      if (parentId && childIds.has(parentId)) return;

      const previous = new Map(state.notebooks.map(nb => [nb.id, { parentId: nb.parentId, order: nb.order }]));
      let changedIds: string[] = [];

      set(s => {
        const oldParentId = moving.parentId;
        const active = s.notebooks.filter(nb => !nb.trashed);
        const oldSiblings = sortNotebooksByOrder(
          active.filter(nb => nb.parentId === oldParentId && nb.id !== id)
        );
        const targetSiblings = sortNotebooksByOrder(
          active.filter(nb => nb.parentId === parentId && nb.id !== id)
        );

        let insertIndex = Math.max(0, Math.min(targetIndex, targetSiblings.length));
        if (oldParentId === parentId) {
          const currentIndex = sortNotebooksByOrder(
            active.filter(nb => nb.parentId === oldParentId)
          ).findIndex(nb => nb.id === id);
          if (currentIndex >= 0 && currentIndex < insertIndex) {
            insertIndex -= 1;
          }
        }

        const targetOrder = [
          ...targetSiblings.slice(0, insertIndex),
          { ...moving, parentId },
          ...targetSiblings.slice(insertIndex),
        ];
        const updates = new Map<string, Partial<Notebook>>();

        targetOrder.forEach((nb, order) => {
          updates.set(nb.id, { parentId, order });
        });

        if (oldParentId !== parentId) {
          oldSiblings.forEach((nb, order) => {
            updates.set(nb.id, { parentId: oldParentId, order });
          });
        }

        const notebooks = s.notebooks.map(nb => {
          const update = updates.get(nb.id);
          return update ? { ...nb, ...update } : nb;
        });

        changedIds = notebooks
          .filter(nb => {
            const before = previous.get(nb.id);
            return before && (before.parentId !== nb.parentId || before.order !== nb.order);
          })
          .map(nb => nb.id);

        return { notebooks };
      });

      if (changedIds.length === 0) return;
      persist();
      changedIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
    },

    deleteNotebook: (id) => {
      if (id === 'default') return;
      const notebookIds = getNotebookTreeIds(id);
      const trashedAt = now();
      const affectedNoteIds = get().notes.filter(n => notebookIds.has(n.notebookId)).map(n => n.id);
      set(s => ({
        notebooks: s.notebooks.map(nb => notebookIds.has(nb.id) ? { ...nb, trashed: true, trashedAt } : nb),
        notes: s.notes.map(n => notebookIds.has(n.notebookId) ? { ...n, trashed: true, trashedAt, pinned: false } : n),
        selectedNotebookId: notebookIds.has(s.selectedNotebookId || '') ? null : s.selectedNotebookId,
        selectedNoteId: affectedNoteIds.includes(s.selectedNoteId || '') ? null : s.selectedNoteId,
        editingNote: affectedNoteIds.includes(s.selectedNoteId || '') ? false : s.editingNote,
      }));
      persist();
      notebookIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
      affectedNoteIds.forEach(noteId => syncNoteToFirestore(noteId));
    },

    restoreNotebook: (id) => {
      const notebookIds = getNotebookTreeIds(id);
      const affectedNoteIds = get().notes.filter(n => notebookIds.has(n.notebookId) && n.trashed).map(n => n.id);
      set(s => {
        const notebooks = s.notebooks.map(nb => notebookIds.has(nb.id) ? { ...nb, trashed: false, trashedAt: undefined } : nb);
        const notes = s.notes.map(n => notebookIds.has(n.notebookId) ? { ...n, trashed: false, trashedAt: undefined } : n);
        return { notebooks, notes, tags: rebuildTags(notes) };
      });
      persist();
      notebookIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
      affectedNoteIds.forEach(noteId => syncNoteToFirestore(noteId));
    },

    permanentlyDeleteNotebook: async (id) => {
      const { notes, notebooks, reminders, uid } = get();
      const plan = buildDeletionPlan({
        allNotes: notes,
        allNotebooks: notebooks,
        allReminders: reminders,
        targetNotebookIds: [id],
        currentUserId: uid,
      });

      const result = await executePermanentDeletion(plan, { currentUserId: uid });

      if (result.deletedNotebookIds.length > 0 || result.deletedNoteIds.length > 0 || result.reparentedNoteIds.length > 0 || result.reparentedNotebookIds.length > 0) {
        const deletedNbSet = new Set(result.deletedNotebookIds);
        const deletedNoteSet = new Set(result.deletedNoteIds);
        const reparentedSet = new Set(result.reparentedNoteIds);
        const reparentedNbSet = new Set(result.reparentedNotebookIds);

        set(s => {
          const remainingNotes = s.notes
            .filter(n => !deletedNoteSet.has(n.id))
            .map(n => reparentedSet.has(n.id) ? { ...n, notebookId: 'default', sectionId: undefined } : n);
          const remainingNotebooks = s.notebooks
            .filter(nb => !deletedNbSet.has(nb.id))
            .map(nb => reparentedNbSet.has(nb.id) ? { ...nb, parentId: null } : nb);
          return {
            notebooks: remainingNotebooks,
            notes: remainingNotes,
            tags: rebuildTags(remainingNotes),
            selectedNotebookId: deletedNbSet.has(s.selectedNotebookId || '') ? null : s.selectedNotebookId,
            selectedNoteId: deletedNoteSet.has(s.selectedNoteId || '') ? null : s.selectedNoteId,
            editingNote: deletedNoteSet.has(s.selectedNoteId || '') ? false : s.editingNote,
            aiNoteContext: s.aiNoteContext && deletedNoteSet.has(s.aiNoteContext.noteId) ? null : s.aiNoteContext,
          };
        });
        persist();
      }

      if (result.deletedReminderIds?.length > 0) {
        const deletedReminderSet = new Set(result.deletedReminderIds);
        set(s => ({
          reminders: s.reminders.filter(r => !deletedReminderSet.has(r.id)),
        }));
        persist();
      }

      if (result.staleSkippedNoteIds?.length > 0) {
        const staleSet = new Set(result.staleSkippedNoteIds);
        set(s => ({
          notes: s.notes.map(n => staleSet.has(n.id) ? { ...n, trashed: false, trashedAt: undefined } : n),
        }));
        persist();
      }

      if (result.staleSkippedNotebookIds?.length > 0) {
        const staleNbSet = new Set(result.staleSkippedNotebookIds);
        set(s => ({
          notebooks: s.notebooks.map(nb => staleNbSet.has(nb.id) ? { ...nb, trashed: false, trashedAt: undefined } : nb),
        }));
        persist();
      }

      return result;
    },


    addSection: (notebookId, name) => {
      const section: Section = {
        id: uuid(),
        name,
        notebookId,
        order: 0,
        color: 'default',
      };
      set(s => ({
        notebooks: s.notebooks.map(nb => {
          if (nb.id !== notebookId) return nb;
          const sections = [...(nb.sections || []), { ...section, order: (nb.sections || []).length }];
          return { ...nb, sections };
        })
      }));
      persist();
      syncNotebookToFirestore(notebookId);
      return section;
    },

    updateSection: (notebookId, sectionId, updates) => {
      set(s => ({
        notebooks: s.notebooks.map(nb => {
          if (nb.id !== notebookId) return nb;
          return {
            ...nb,
            sections: (nb.sections || []).map(sec =>
              sec.id === sectionId ? { ...sec, ...updates } : sec
            ),
          };
        })
      }));
      persist();
      syncNotebookToFirestore(notebookId);
    },

    deleteSection: (notebookId, sectionId) => {
      const affectedNoteIds = get().notes.filter(n => n.sectionId === sectionId).map(n => n.id);
      set(s => ({
        notebooks: s.notebooks.map(nb => {
          if (nb.id !== notebookId) return nb;
          return { ...nb, sections: (nb.sections || []).filter(sec => sec.id !== sectionId) };
        }),
        notes: s.notes.map(n =>
          n.sectionId === sectionId ? { ...n, sectionId: undefined } : n
        ),
      }));
      persist();
      syncNotebookToFirestore(notebookId);
      affectedNoteIds.forEach(noteId => syncNoteToFirestore(noteId));
    },

    // ── Tags ──
    createTag: (name, color = 'default') => {
      const tag: Tag = { id: name.toLowerCase().replace(/\s+/g, '-'), name, color, count: 0 };
      set(s => {
        if (s.tags.find(t => t.name.toLowerCase() === name.toLowerCase())) return s;
        return { tags: [...s.tags, tag] };
      });
      return { id: name.toLowerCase().replace(/\s+/g, '-'), name, color, count: 0 };
    },

    deleteTag: (id) => {
      const tag = get().tags.find(t => t.id === id);
      if (!tag) return;
      set(s => ({
        tags: s.tags.filter(t => t.id !== id),
        notes: s.notes.map(n => ({
          ...n,
          tags: n.tags.filter(t => t !== tag.name),
        })),
      }));
      persist();
    },

    renameTag: (id, name) => {
      const oldTag = get().tags.find(t => t.id === id);
      if (!oldTag) return;
      set(s => ({
        tags: s.tags.map(t => t.id === id ? { ...t, name, id: name.toLowerCase().replace(/\s+/g, '-') } : t),
        notes: s.notes.map(n => ({
          ...n,
          tags: n.tags.map(t => t === oldTag.name ? name : t),
        })),
      }));
      persist();
    },

    // ── Search & Navigation ──
    saveCurrentSearch: (name) => {
      const saved: SavedSearch = {
        id: uuid(),
        name: name.trim() || 'Saved search',
        filters: { ...get().searchFilters },
        createdAt: now(),
      };
      set(s => ({ savedSearches: [saved, ...s.savedSearches] }));
      persist();
      return saved;
    },
    applySavedSearch: (id) => {
      const saved = get().savedSearches.find(item => item.id === id);
      if (!saved) return;
      set({ searchFilters: { ...saved.filters }, currentView: 'search', selectedNoteId: null, editingNote: false });
    },
    deleteSavedSearch: (id) => {
      set(s => ({ savedSearches: s.savedSearches.filter(item => item.id !== id) }));
      persist();
    },
    setSearchFilters: (filters) => {
      set(s => ({ searchFilters: { ...s.searchFilters, ...filters } }));
    },
    clearSearch: () => set({ searchFilters: defaultSearchFilters }),
    setCurrentView: (view) => set(s => ({
      previousView: s.currentView !== view ? s.currentView : s.previousView,
      currentView: view,
      selectedNoteId: null,
      editingNote: false,
    })),
    navigateBack: () => set(s => ({
      currentView: s.previousView && s.previousView !== s.currentView ? s.previousView : 'home',
      previousView: 'home',
      selectedNoteId: null,
      editingNote: false,
    })),
    setActiveChatId: (chatId) => set({ activeChatId: chatId }),
    setAiNoteContext: (context) => set({ aiNoteContext: context }),
    openSettings: (section = 'profile') => set(s => ({
      previousView: s.currentView !== 'settings' ? s.currentView : s.previousView,
      settingsSection: section,
      currentView: 'settings',
      selectedNoteId: null,
      editingNote: false,
    })),
    selectNote: (id) => set({ selectedNoteId: id, editingNote: !!id }),
    selectNotebook: (id) => set({ selectedNotebookId: id }),
    selectTag: (id) => set({ selectedTagId: id }),
    setSidebarOpen: (open) => set({ sidebarOpen: open }),
    setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    setEditingNote: (editing) => set({ editingNote: editing }),

    // ── Scratch Pad ──
    updateScratchPad: (content) => {
      set({ scratchPad: content });
      persist();
    },

    // ── Templates ──
    createFromTemplate: (templateId, options) => {
      const template = get().templates.find(t => t.id === templateId);
      if (!template) return Promise.resolve(null);
      const draft = buildTemplateDraft(template, options?.title, new Date(), options?.values || {}, options?.includeExamples ?? true);
      return get().createNote({
        title: draft.title,
        content: draft.content,
        type: draft.type,
        theme: template.theme || get().settings.defaultNoteTheme,
        tags: [...template.tags],
        checklist: draft.checklist.map(c => ({ ...c, id: uuid() })),
      });
    },

    createTeamSpace: (name, notebookIds = []) => {
      const { uid, profile } = get();
      const trimmed = name.trim() || 'Team Space';
      const teamSpace: TeamSpace = {
        id: uuid(),
        name: trimmed,
        icon: '\uD83C\uDFE2',
        color: 'blue',
        pinned: true,
        notebookIds,
        members: [],
        ownerId: uid || undefined,
        createdAt: now(),
        updatedAt: now(),
      };

      set(s => ({ teamSpaces: [teamSpace, ...s.teamSpaces] }));
      persist();
      syncTeamSpaceToFirestore(teamSpace.id);

      notebookIds.forEach(notebookId => {
        const notebook = get().notebooks.find(nb => nb.id === notebookId);
        if (notebook) {
          get().updateNotebook(notebookId, { teamSpaceId: teamSpace.id });
        }
      });

      void get().addActivity({
        entityType: 'team-space',
        entityId: teamSpace.id,
        teamSpaceId: teamSpace.id,
        action: 'team-space-created',
        message: `Created team space ${trimmed}.`,
        participants: [profile.email],
      });

      return teamSpace;
    },

    updateTeamSpace: (id, updates) => {
      set(s => ({
        teamSpaces: s.teamSpaces.map(space =>
          space.id === id ? { ...space, ...updates, updatedAt: now() } : space
        ),
      }));
      persist();
      syncTeamSpaceToFirestore(id);
    },

    deleteTeamSpace: (id) => {
      const affectedNotebookIds = get().notebooks
        .filter(nb => nb.teamSpaceId === id)
        .map(nb => nb.id);
      set(s => ({
        teamSpaces: s.teamSpaces.filter(space => space.id !== id),
        notebooks: s.notebooks.map(nb => nb.teamSpaceId === id ? { ...nb, teamSpaceId: null } : nb),
      }));
      persist();
      deleteTeamSpaceFromFirestore(id);
      affectedNotebookIds.forEach(notebookId => syncNotebookToFirestore(notebookId));
    },

    addActivity: async (item) => {
      const { uid, profile } = get();
      const participants = [...new Set(item.participants.map(normalizeEmail).filter(Boolean))];
      const activity: ActivityItem = {
        ...item,
        id: uuid(),
        actorEmail: normalizeEmail(item.actorEmail || profile.email || 'local'),
        actorName: item.actorName || profile.name,
        participants,
        createdAt: now(),
      };

      set(s => ({
        activityItems: [activity, ...s.activityItems.filter(existing => existing.id !== activity.id)].slice(0, 200),
      }));
      persist();

      if (uid && item.shared && participants.length > 1) {
        await setDoc(doc(db, 'activity_feed', activity.id), stripUndefined(activity)).catch(console.error);
      }

      return activity;
    },

    shareNote: async (noteId, sharedWith, isPublished, shareAccess) => {
      const { notes, uid, profile, online } = get();
      const note = notes.find(n => n.id === noteId);
      if (!note || !uid) return;
      if (!online) throw new Error('Connect to the internet before changing note sharing.');

      const access = normalizeShareAccess(shareAccess || legacyEmailsToShareAccess(sharedWith, note.shareAccess));
      const roleArrays = shareAccessToRoleArrays(access);
      const isSharedOrPublished = roleArrays.sharedWith.length > 0 || isPublished;
      const sharedBy = note.sharedBy || profile.email || 'Anonymous';
      // If unsharing a note that was shared, ensure we read the latest shared authority
      let finalContent = note.content;
      let finalTitle = note.title;
      let finalTags = note.tags;
      let finalUpdatedAt = note.updatedAt;

      if (!isSharedOrPublished && note.isShared) {
        try {
          const sharedDocRef = doc(db, 'shared_notes', noteId);
          const sharedDocSnap = await getDoc(sharedDocRef);
          if (sharedDocSnap.exists()) {
            const sharedData = sharedDocSnap.data() as Note;
            if (sharedData.content !== undefined) finalContent = sharedData.content;
            if (sharedData.title !== undefined) finalTitle = sharedData.title;
            if (sharedData.tags !== undefined) finalTags = sharedData.tags;
            if (sharedData.updatedAt !== undefined) finalUpdatedAt = sharedData.updatedAt;
          }
        } catch (fetchErr) {
          console.warn('Could not read latest shared document before unshare, falling back to local copy:', fetchErr);
        }
      }

      const updatedNote: Note = {
        ...note,
        title: finalTitle,
        content: finalContent,
        tags: finalTags,
        updatedAt: !isSharedOrPublished && note.isShared ? now() : finalUpdatedAt,
        ownerId: note.ownerId || uid,
        ...roleArrays,
        shareAccess: access,
        isPublished,
        isShared: isSharedOrPublished,
        sharedBy,
      };

      set(s => ({
        notes: s.notes.map(n => n.id === noteId ? updatedNote : n)
      }));
      persist();

      if (isSharedOrPublished) {
        await setDoc(doc(db, 'shared_notes', noteId), stripUndefined(updatedNote));
      } else {
        if (note.isShared) {
          await deleteDoc(doc(db, 'shared_notes', noteId));
        }
      }
      await setDoc(doc(db, `users/${uid}/notes`, noteId), stripUndefined(updatedNote));

      await get().addActivity({
        entityType: 'note',
        entityId: noteId,
        noteId,
        action: 'share-updated',
        message: isSharedOrPublished
          ? `Updated sharing for ${note.title || 'Untitled note'}.`
          : `Stopped sharing ${note.title || 'Untitled note'}.`,
        participants: getEntityParticipants(updatedNote, sharedBy),
        shared: isSharedOrPublished,
      });
    },

    shareNotebook: async (notebookId, sharedWith, shareAccess) => {
      const { notebooks, uid, profile, online } = get();
      const notebook = notebooks.find(nb => nb.id === notebookId);
      if (!notebook || !uid) return;
      if (!online) throw new Error('Connect to the internet before changing notebook sharing.');

      const access = normalizeShareAccess(shareAccess || legacyEmailsToShareAccess(sharedWith, notebook.shareAccess));
      const roleArrays = shareAccessToRoleArrays(access);
      const isShared = roleArrays.sharedWith.length > 0;
      const sharedBy = notebook.sharedBy || profile.email || 'Anonymous';
      const updatedNotebook: Notebook = {
        ...notebook,
        ownerId: notebook.ownerId || uid,
        ...roleArrays,
        shareAccess: access,
        isShared,
        sharedBy,
      };

      set(s => ({
        notebooks: s.notebooks.map(nb => nb.id === notebookId ? updatedNotebook : nb)
      }));
      persist();

      if (isShared) {
        await setDoc(doc(db, 'shared_notebooks', notebookId), stripUndefined(updatedNotebook));
      } else {
        if (notebook.isShared) {
          await deleteDoc(doc(db, 'shared_notebooks', notebookId));
        }
      }
      await setDoc(doc(db, `users/${uid}/notebooks`, notebookId), stripUndefined(updatedNotebook));

      await get().addActivity({
        entityType: 'notebook',
        entityId: notebookId,
        notebookId,
        teamSpaceId: notebook.teamSpaceId || undefined,
        action: 'share-updated',
        message: isShared
          ? `Updated sharing for notebook ${notebook.name}.`
          : `Stopped sharing notebook ${notebook.name}.`,
        participants: getEntityParticipants(updatedNotebook, sharedBy),
        shared: isShared,
      });
    },

    // ── Export/Import ──
    exportAllNotes: () => {
      const { notes, notebooks, teamSpaces, activityItems, notifications, profile } = get();
      return JSON.stringify({ notes, notebooks, teamSpaces, activityItems, notifications, profile, exportedAt: now() }, null, 2);
    },

    importNotes: (json) => {
      try {
        const data = JSON.parse(json);
        if (data.notes && Array.isArray(data.notes)) {
          let importedNotes: Note[] = [];
          set(s => {
            const existingIds = new Set(s.notes.map(n => n.id));
            const newNotes = data.notes.filter((n: Note) => !existingIds.has(n.id));
            importedNotes = newNotes;
            const notes = [...s.notes, ...newNotes];
            const importedTeamSpaces = Array.isArray(data.teamSpaces)
              ? data.teamSpaces.filter((space: TeamSpace) => !s.teamSpaces.some(existing => existing.id === space.id))
              : [];
            const importedActivity = Array.isArray(data.activityItems)
              ? data.activityItems.filter((item: ActivityItem) => !s.activityItems.some(existing => existing.id === item.id))
              : [];
            const importedNotifications = Array.isArray(data.notifications)
              ? data.notifications.filter((item: AppNotification) => !s.notifications.some(existing => existing.id === item.id))
              : [];
            return {
              notes,
              tags: rebuildTags(notes),
              teamSpaces: [...s.teamSpaces, ...importedTeamSpaces],
              activityItems: [...importedActivity, ...s.activityItems].slice(0, 200),
              notifications: capNotifications([...importedNotifications, ...s.notifications]),
            };
          });
          if (data.notebooks && Array.isArray(data.notebooks)) {
            set(s => {
              const existingIds = new Set(s.notebooks.map(nb => nb.id));
              const newNbs = data.notebooks.filter((nb: Notebook) => !existingIds.has(nb.id));
              return { notebooks: [...s.notebooks, ...newNbs] };
            });
          }
          persist();
          importedNotes.forEach(note => syncNoteToFirestore(note.id));
          if (Array.isArray(data.teamSpaces)) {
            data.teamSpaces.forEach((space: TeamSpace) => syncTeamSpaceToFirestore(space.id));
          }
          if (Array.isArray(data.notifications)) {
            data.notifications.forEach((notification: AppNotification) => syncNotificationToFirestore(notification.id));
          }
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },

    // ── Cloud snapshot backups ──
    createCloudBackup: async (trigger = 'manual') => {
      const { uid, exportAllNotes, updateSettings } = get();
      if (!uid) {
        throw new Error('Sign in to save cloud backups.');
      }
      const meta = await saveCloudBackup(uid, exportAllNotes(), trigger);
      updateSettings({ lastBackupAt: meta.createdAt });
      return meta;
    },

    fetchCloudBackups: async () => {
      const { uid } = get();
      if (!uid) return [];
      return listCloudBackups(uid);
    },

    deleteCloudBackup: async (backupId) => {
      const { uid } = get();
      if (!uid) {
        throw new Error('Sign in to manage cloud backups.');
      }
      await removeCloudBackup(uid, backupId);
    },

    restoreCloudBackup: async (backupId, mode = 'merge') => {
      const { uid, notes, notebooks, importNotes } = get();
      if (!uid) {
        throw new Error('Sign in to restore cloud backups.');
      }

      const payload = await loadCloudBackupPayload(uid, backupId);
      let data: { notes?: Note[]; notebooks?: Notebook[] };
      try {
        data = JSON.parse(payload);
      } catch {
        throw new Error('This backup is corrupted and cannot be restored.');
      }
      if (!data || !Array.isArray(data.notes)) {
        throw new Error('This backup does not contain any notes.');
      }

      if (mode === 'replace') {
        // Clear the local workspace first so the sync listeners never see a
        // remote-empty state with stale local notes and re-upload them.
        // Notes shared with collaborators are kept so their links survive.
        const keptNotes = notes.filter(note => note.isShared);
        const keptNotebooks = notebooks.filter(nb => nb.isShared || nb.id === 'default');
        const removedNoteIds = notes.filter(note => !note.isShared).map(note => note.id);
        const removedNotebookIds = notebooks
          .filter(nb => !nb.isShared && nb.id !== 'default')
          .map(nb => nb.id);

        set({
          notes: keptNotes,
          notebooks: keptNotebooks,
          tags: rebuildTags(keptNotes),
        });
        persist();

        await Promise.all([
          ...removedNoteIds.map(id =>
            deleteDoc(doc(db, `users/${uid}/notes`, id)).catch(console.error)),
          ...removedNotebookIds.map(id =>
            deleteDoc(doc(db, `users/${uid}/notebooks`, id)).catch(console.error)),
        ]);
      }

      if (!importNotes(payload)) {
        throw new Error('Restore failed: the backup could not be imported.');
      }
      return {
        restoredNotes: data.notes.length,
        restoredNotebooks: Array.isArray(data.notebooks) ? data.notebooks.length : 0,
      };
    },

    resetApp: async () => {
      const {
        notes,
        uid,
        unsubscribeNotes,
        unsubscribeNotebooks,
        unsubscribeSettings,
        unsubscribeTeamSpaces,
        unsubscribeActivity,
        unsubscribeNotifications,
        unsubscribeReminders,
        unsubscribeSharedNotes,
        unsubscribeSharedNotebooks,
      } = get();
      if (unsubscribeNotes) unsubscribeNotes();
      if (unsubscribeNotebooks) unsubscribeNotebooks();
      if (unsubscribeSettings) unsubscribeSettings();
      if (unsubscribeTeamSpaces) unsubscribeTeamSpaces();
      if (unsubscribeActivity) unsubscribeActivity();
      if (unsubscribeNotifications) unsubscribeNotifications();
      if (unsubscribeReminders) unsubscribeReminders();
      if (unsubscribeSharedNotes) unsubscribeSharedNotes();
      if (unsubscribeSharedNotebooks) unsubscribeSharedNotebooks();
      if (uid) {
        await Promise.all(notes.map(note =>
          deleteDoc(doc(db, `users/${uid}/notes`, note.id)).catch(console.error)
        ));
        await signOut(auth).catch(console.error);
      }
      // Clear the active workspace's scoped keys
      WORKSPACE_SHORT_KEYS.forEach(k => localStorage.removeItem(wsKey(k)));
      // Also clean up any legacy global keys
      LEGACY_GLOBAL_KEYS.forEach(k => localStorage.removeItem(k));
      set({
        notes: [],
        notebooks: [defaultNotebook],
        tags: [],
        teamSpaces: [],
        activityItems: [],
        notifications: [],
        reminders: [],
        profile: defaultProfile,
        settings: defaultSettings,
        isOnboarded: false,
        uid: null,
        unsubscribeNotes: null,
        unsubscribeNotebooks: null,
        unsubscribeSettings: null,
        unsubscribeTeamSpaces: null,
        unsubscribeActivity: null,
        unsubscribeNotifications: null,
        unsubscribeReminders: null,
        unsubscribeSharedNotes: null,
        unsubscribeSharedNotebooks: null,
        currentView: 'home',
        settingsSection: 'profile',
        selectedNoteId: null,
        editingNote: false,
        searchFilters: defaultSearchFilters,
        scratchPad: '',
        savedSearches: [],
        syncQueue: [],
        syncConflicts: [],
        unlockedNotes: {},
        syncCenterOpen: false,
      });
    },

    // ── Computed ──
    getFilteredNotes: () => {
      const { notes, searchFilters, currentView, selectedNotebookId, selectedTagId } = get();
      let filtered = notes.filter(n => !n.trashed && !n.archived);
      if (currentView === 'shared') {
        filtered = filtered.filter(n => n.isShared);
      } else {
        filtered = filtered.filter(n => !n.isShared);
      }

      if (currentView === 'trash') filtered = notes.filter(n => n.trashed);
      else if (currentView === 'archived') filtered = notes.filter(n => n.archived && !n.trashed);
      else if (currentView === 'starred') filtered = notes.filter(n => n.starred && !n.trashed && !n.archived);
      else if (currentView === 'reminders') filtered = notes.filter(n => n.reminder && !n.trashed);
      else if (currentView === 'notebooks' && selectedNotebookId) {
        filtered = filtered.filter(n => n.notebookId === selectedNotebookId);
      }
      else if (currentView === 'tags' && selectedTagId) {
        const tag = get().tags.find(t => t.id === selectedTagId);
        if (tag) filtered = filtered.filter(n => n.tags.includes(tag.name));
      }

      const { query, tags, colors, types, priorities, hasReminder, hasChecklist, sortBy, sortDir, sharedBy } = searchFilters;
      
      if (query) {
        const q = query.toLowerCase();
        filtered = filtered.filter(n =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some(t => t.toLowerCase().includes(q))
        );
      }
      if (tags.length) filtered = filtered.filter(n => tags.some(t => n.tags.includes(t)));
      if (colors.length) filtered = filtered.filter(n => colors.includes(n.color));
      if (types.length) filtered = filtered.filter(n => types.includes(n.type));
      if (priorities.length) filtered = filtered.filter(n => n.priority && priorities.includes(n.priority));
      if (hasReminder === true) filtered = filtered.filter(n => n.reminder);
      if (hasReminder === false) filtered = filtered.filter(n => !n.reminder);
      if (hasChecklist === true) filtered = filtered.filter(n => n.type === 'checklist' || n.checklist.length > 0);
      if (sharedBy && sharedBy.length) filtered = filtered.filter(n => n.sharedBy && sharedBy.includes(n.sharedBy));

      filtered.sort((a, b) => {
        // Pinned always first
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        
        let cmp = 0;
        if (sortBy === 'order') cmp = (a.order ?? 0) - (b.order ?? 0);
        else if (sortBy === 'title') cmp = (a.title || 'Untitled').localeCompare(b.title || 'Untitled');
        else if (sortBy === 'priority') {
          const pOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
          const aP = a.priority ? pOrder[a.priority] : 0;
          const bP = b.priority ? pOrder[b.priority] : 0;
          cmp = aP - bP;
        }
        else if (sortBy === 'wordCount') cmp = (a.wordCount ?? 0) - (b.wordCount ?? 0);
        else cmp = new Date(a[sortBy]).getTime() - new Date(b[sortBy]).getTime();
        
        return sortDir === 'desc' ? -cmp : cmp;
      });

      return filtered;
    },

    getRecentNotes: (limit = 5) => {
      return get().notes
        .filter(n => !n.trashed && !n.archived)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, limit);
    },

    getPinnedNotes: () => get().notes.filter(n => n.pinned && !n.trashed && !n.archived),
    getStarredNotes: () => get().notes.filter(n => n.starred && !n.trashed && !n.archived),
    getArchivedNotes: () => get().notes.filter(n => n.archived && !n.trashed),
    getTrashedNotes: () => get().notes.filter(n => n.trashed),
    getNotesByNotebook: (notebookId) => get().notes.filter(n => n.notebookId === notebookId && !n.trashed),
    getNotesByTag: (tag) => get().notes.filter(n => n.tags.includes(tag) && !n.trashed),
    getNoteById: (id) => get().notes.find(n => n.id === id),
    getNotebookById: (id) => get().notebooks.find(nb => nb.id === id),
    getChildNotebooks: (parentId) => sortNotebooksByOrder(get().notebooks.filter(nb => nb.parentId === parentId)),

    getAllTags: () => get().tags,

    getStats: () => {
      const notes = get().notes.filter(n => !n.trashed);
      const allChecklist = notes.flatMap(n => n.checklist || []).filter(Boolean);
      return {
        notes: notes.filter(n => !n.archived).length,
        words: notes.reduce((sum, n) => sum + (n.wordCount || 0), 0),
        tags: get().tags.length,
        notebooks: get().notebooks.length,
        tasks: allChecklist.length,
        completedTasks: allChecklist.filter(c => Boolean(c?.checked)).length,
      };
    },

    getReminders: () => {
      return get().notes
        .filter(n => n.reminder && !n.trashed)
        .map(n => n.reminder!)
        .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());
    },
  };
});
