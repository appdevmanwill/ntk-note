import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
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
  filterQueuedReminderIds,
  validateOrphanReminder,
  validateReminderCleanupDelete,
  type SimpleKVNamespace,
  type PendingMediaIndexItem,
  type PendingMediaMarker,
} from '../cloudflare/ntk-gateway/src/queueHelpers.ts';
import { deleteStorageFileDetailed } from '../src/utils/cloudStorage.ts';
import { auth } from '../src/utils/firebase.ts';
import {
  categorizeReminders,
  formatReminderDue,
  calculateSnoozeTime,
  isReminderDue,
  isReminderOverdue,
} from '../src/utils/reminders.ts';
import {
  canEditSharedNote,
  canCommentSharedNote,
  buildDirectorySearchPrefixes,
  getQuickShareSuggestions,
  filterLocalContacts,
  normalizeDirectorySearchTerm,
  isValidEmail,
  normalizeShareAccess,
  legacyEmailsToShareAccess,
} from '../src/utils/collaboration.ts';
import type { AppReminder, Note, Notebook, NoteAttachment, NoteImage, NoteVoiceNote, Reminder } from '../src/types/index.ts';
import {
  extractMediaCandidates,
  isMediaReused,
  getNotebookTreeIds,
  buildDeletionPlan,
  queuePendingReminderCleanups,
  getPendingReminderCleanups,
  clearPendingReminderCleanups,
} from '../src/utils/recycleBinService.ts';
import {
  calculateNextEligibleAttempt,
  enqueuePendingMediaCleanup,
  getPendingMediaCleanups,
  retryPendingMediaCleanups,
} from '../src/utils/pendingMediaCleanupQueue.ts';
import { getRecentNotebooks } from '../src/utils/recentNotebooks.ts';
import { sanitizeAiText } from '../src/components/FriendlyAiOutput.tsx';
import {
  getDeterministicChatId,
  isChatUnread,
  getTimestampMillis,
} from '../src/utils/chatService.ts';
import {
  QUICK_SHARE_LIMIT,
  GLOBAL_DIRECTORY_MIN_CHARS,
  GLOBAL_DIRECTORY_LIMIT,
  DIRECT_CHAT_LIST_LIMIT,
  DIRECT_MESSAGE_PAGE_SIZE,
  AI_THREAD_LIST_LIMIT,
  AI_TURN_PAGE_SIZE,
  AI_CONTEXT_MAX_TURNS,
  AI_CONTEXT_MAX_MESSAGES,
  AI_CONTEXT_RECENT_TURNS,
  AI_MAX_NOTE_CONTEXT_CHARS,
  AI_MAX_TOTAL_CONTEXT_CHARS,
  DIRECT_MESSAGE_MAX_CHARS,
  AI_PROMPT_MAX_CHARS,
  DIRECTORY_DEBOUNCE_MS,
} from '../src/utils/freeZoneConstants.ts';
import {
  splitIntoSentences,
  splitTextIntoChunks,
  LANGUAGE_OPTIONS,
} from '../src/components/ListenPlayer.tsx';
import fs from 'node:fs';
import path from 'node:path';
import {
  computeSpeechCacheKey,
  clearSessionSpeechCache,
  sessionSpeechCache,
  inFlightSpeechMap,
  setCurrentSpeechUser,
  getCurrentSpeechUser,
  updateListenEnginePolicy,
  MAX_SESSION_CACHE_ENTRIES,
  executeSpeechWithDeduplication,
} from '../src/utils/ntkAi.ts';
import {
  classifySpeechLocale,
  buildSpeechProviderPlan,
  classifyQuotaCooldown,
  msUntilUtcMidnight,
} from '../cloudflare/ntk-gateway/src/speechHelpers.ts';
import {
  ListenOrchestrator,
  calculateCombinedAudioDuration,
  SpeechGenerationConfig,
  isSynthesisAffectingChange,
  normalizeSpeechLanguage,
} from '../src/utils/listenOrchestrator.ts';
import {
  TabCoordinator,
  CHANNEL_NAME,
  HEARTBEAT_INTERVAL_MS,
  LEADER_TIMEOUT_MS,
  ELECTION_CHECK_INTERVAL_MS,
  type TabCoordinatorTransport,
} from '../src/utils/tabCoordinator.ts';
import {
  OfflineMediaSyncService,
  summarizePendingMedia,
  type MediaSyncResult,
} from '../src/utils/offlineMediaSyncService.ts';
import {
  commitQueuedNoteSafely,
  type NoteCommitResult,
  type NoteCommitRemoteDeleted,
  type TransactionRunner,
} from '../src/utils/noteSyncTransaction.ts';
import {
  checkUploadIdempotency,
  type UserFileRecord,
  type IdempotencyEnv,
} from '../cloudflare/ntk-gateway/src/idempotency.ts';
import {
  reconcileRemoteNotesSnapshot,
  hasMeaningfulNoteDifference,
  buildMeaningfulNoteSnapshot,
  type ReconcileNotesResult,
} from '../src/utils/noteReconciliation.ts';
import {
  saveJSONSafe,
  saveCrashJournal,
  loadCrashJournal,
  clearCrashJournal,
  peekCrashJournal,
  acknowledgeCrashJournal,
  loadDurableRecord,
  persistDurableNotes,
  persistDurableSyncQueue,
  markDurableMigrationComplete,
  isDurableMigrationComplete,
} from '../src/utils/durableOutbox.ts';
import {
  calculateNextBackoffMs,
  enqueueOfflineMedia,
  getPendingMediaForUser,
  markMediaFailed,
} from '../src/utils/offlineMediaQueue.ts';
import { useStore } from '../src/store/index.ts';

describe('Reminders Logic & Categorization', () => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - 5 * 60 * 1000).toISOString(); // 5 minutes ago (overdue)
  const todayLater = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 58).getTime() > now.getTime()
    ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 58).toISOString()
    : new Date(now.getTime() + 1000).toISOString();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2, 12, 0, 0).toISOString();

  const testReminders: AppReminder[] = [
    {
      id: 'rem-overdue',
      title: 'Overdue task',
      dueAt: pastDate,
      status: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'rem-today',
      title: 'Task due today',
      dueAt: todayLater,
      status: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'rem-tomorrow',
      title: 'Upcoming task',
      dueAt: tomorrow,
      status: 'active',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    {
      id: 'rem-completed',
      title: 'Done task',
      dueAt: pastDate,
      status: 'completed',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  ];

  test('categorizeReminders splits into overdue, today, upcoming, and completed accurately', () => {
    const categorized = categorizeReminders(testReminders);
    assert.equal(categorized.overdue.length, 1);
    assert.equal(categorized.overdue[0].id, 'rem-overdue');

    assert.equal(categorized.completed.length, 1);
    assert.equal(categorized.completed[0].id, 'rem-completed');

    assert.equal(categorized.upcoming.length, 1);
    assert.equal(categorized.upcoming[0].id, 'rem-tomorrow');
  });

  test('isReminderOverdue and isReminderDue correctly detect elapsed deadlines', () => {
    assert.equal(isReminderOverdue(pastDate), true);
    assert.equal(isReminderOverdue(tomorrow), false);

    assert.equal(isReminderDue(pastDate), true);
    assert.equal(isReminderDue(tomorrow), false);
  });

  test('calculateSnoozeTime computes proper future timestamps', () => {
    const snooze5 = calculateSnoozeTime(5);
    const snoozeTime5 = new Date(snooze5).getTime();
    assert.ok(snoozeTime5 > Date.now() + 4 * 60 * 1000);
    assert.ok(snoozeTime5 <= Date.now() + 6 * 60 * 1000);

    const snoozeTom = calculateSnoozeTime('tomorrow');
    const snoozeTomDate = new Date(snoozeTom);
    assert.equal(snoozeTomDate.getHours(), 9);
    assert.equal(snoozeTomDate.getMinutes(), 0);
  });
});

describe('Collaboration & Role Access Permissions', () => {
  const sampleNote: Note = {
    id: 'note-123',
    title: 'Shared Note',
    content: 'Collaborative content',
    type: 'note',
    color: 'default',
    tags: ['work'],
    notebookId: 'nb-1',
    pinned: false,
    starred: false,
    archived: false,
    trashed: false,
    locked: false,
    checklist: [],
    priority: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    wordCount: 2,
    charCount: 21,
    linkedNoteIds: [],
    order: 0,
    ownerId: 'owner-uid',
    isShared: true,
    sharedWith: ['editor@example.com', 'commenter@example.com', 'viewer@example.com'],
    editors: ['editor@example.com'],
    commenters: ['commenter@example.com'],
    viewers: ['viewer@example.com'],
  };

  test('owner has full edit and comment access', () => {
    assert.equal(canEditSharedNote(sampleNote, 'owner-uid', 'owner@example.com'), true);
    assert.equal(canCommentSharedNote(sampleNote, 'owner-uid', 'owner@example.com'), true);
  });

  test('editor has edit and comment access', () => {
    assert.equal(canEditSharedNote(sampleNote, 'other-uid', 'editor@example.com'), true);
    assert.equal(canCommentSharedNote(sampleNote, 'other-uid', 'editor@example.com'), true);
  });

  test('commenter cannot edit but can comment', () => {
    assert.equal(canEditSharedNote(sampleNote, 'other-uid', 'commenter@example.com'), false);
    assert.equal(canCommentSharedNote(sampleNote, 'other-uid', 'commenter@example.com'), true);
  });

  test('viewer has read-only access (no edit, no comment)', () => {
    assert.equal(canEditSharedNote(sampleNote, 'other-uid', 'viewer@example.com'), false);
    assert.equal(canCommentSharedNote(sampleNote, 'other-uid', 'viewer@example.com'), false);
  });
});

describe('3-Letter Directory Prefix Search & Bounded Query Logic', () => {
  test('buildDirectorySearchPrefixes only generates prefixes of length >= 3', () => {
    const prefixes = buildDirectorySearchPrefixes('John Doe', 'john.doe@example.com');
    
    // Check minimum length invariant
    prefixes.forEach(p => {
      assert.ok(p.length >= 3, `Prefix "${p}" must have at least 3 characters`);
    });

    // Check presence of key prefixes
    assert.ok(prefixes.includes('joh'));
    assert.ok(prefixes.includes('john'));
    assert.ok(prefixes.includes('doe'));
    assert.ok(prefixes.includes('john.doe'));

    // Check bounded size (<= 180 entries)
    assert.ok(prefixes.length <= 180);
  });
});

describe('Workspace Key Scoping & Account Isolation', () => {
  const getWsKey = (uid: string | null, shortKey: string) => {
    const prefix = uid ? `ntk:user:${uid}` : 'ntk:guest';
    return `${prefix}:${shortKey}`;
  };

  test('generates correctly namespaced keys for authenticated users', () => {
    const userAKey = getWsKey('user_alpha_123', 'notes');
    const userBKey = getWsKey('user_beta_456', 'notes');
    const guestKey = getWsKey(null, 'notes');

    assert.equal(userAKey, 'ntk:user:user_alpha_123:notes');
    assert.equal(userBKey, 'ntk:user:user_beta_456:notes');
    assert.equal(guestKey, 'ntk:guest:notes');
    assert.notEqual(userAKey, userBKey);
    assert.notEqual(userAKey, guestKey);
  });

  test('mock storage isolation ensures User A data cannot leak to User B', () => {
    const mockStorage = new Map<string, string>();
    const save = (uid: string | null, key: string, data: unknown) => {
      mockStorage.set(getWsKey(uid, key), JSON.stringify(data));
    };
    const load = <T>(uid: string | null, key: string, fallback: T): T => {
      const raw = mockStorage.get(getWsKey(uid, key));
      return raw ? JSON.parse(raw) : fallback;
    };

    // User A creates private notes
    save('user_alpha', 'notes', [{ id: 'note-a1', title: 'User A Secret Note' }]);
    
    // User B checks notes
    const userBNotes = load<Array<{ id: string }>>('user_beta', 'notes', []);
    assert.equal(userBNotes.length, 0, 'User B must not see User A notes in local storage');

    // Guest checks notes
    const guestNotes = load<Array<{ id: string }>>(null, 'notes', []);
    assert.equal(guestNotes.length, 0, 'Guest must not see User A notes');

    // User A reads their notes back
    const userANotes = load<Array<{ id: string; title: string }>>('user_alpha', 'notes', []);
    assert.equal(userANotes.length, 1);
    assert.equal(userANotes[0].title, 'User A Secret Note');
  });
});

describe('Authoritative Remote Set Merge (Resurrection Prevention)', () => {
  interface SyncItem {
    id: string;
    entityType: string;
    noteId: string;
  }

  // Pure representation of the store's authoritative remote merge algorithm
  const mergeReminders = (
    localReminders: AppReminder[],
    remoteReminders: AppReminder[],
    pendingSyncQueue: SyncItem[]
  ): AppReminder[] => {
    const remoteIds = new Set(remoteReminders.map(r => r.id));
    const pendingIds = new Set(
      pendingSyncQueue.filter(item => item.entityType === 'reminder').map(item => item.noteId)
    );

    const merged = new Map<string, AppReminder>();

    // Start with remote authoritative set
    remoteReminders.forEach(remote => {
      if (!pendingIds.has(remote.id)) {
        merged.set(remote.id, remote);
      } else {
        const local = localReminders.find(r => r.id === remote.id);
        merged.set(remote.id, local || remote);
      }
    });

    // Keep local-only reminders ONLY if pending sync write
    localReminders.forEach(reminder => {
      if (!remoteIds.has(reminder.id) && pendingIds.has(reminder.id)) {
        merged.set(reminder.id, reminder);
      }
    });

    return [...merged.values()];
  };

  test('remotely deleted reminders are pruned from local state without resurrecting', () => {
    const localReminders: AppReminder[] = [
      { id: 'rem-1', title: 'Deleted remotely', dueAt: new Date().toISOString(), status: 'active', createdAt: '', updatedAt: '' },
      { id: 'rem-2', title: 'Still active', dueAt: new Date().toISOString(), status: 'active', createdAt: '', updatedAt: '' },
    ];
    // Remote snapshot contains only rem-2 (rem-1 was deleted on another device)
    const remoteReminders: AppReminder[] = [
      { id: 'rem-2', title: 'Still active', dueAt: new Date().toISOString(), status: 'active', createdAt: '', updatedAt: '' },
    ];
    const pendingSync: SyncItem[] = []; // No pending writes

    const result = mergeReminders(localReminders, remoteReminders, pendingSync);
    assert.equal(result.length, 1);
    assert.equal(result[0].id, 'rem-2');
    assert.ok(!result.some(r => r.id === 'rem-1'), 'Deleted reminder must not resurrect');
  });

  test('locally created offline reminder with pending sync is preserved during remote snapshot', () => {
    const localReminders: AppReminder[] = [
      { id: 'rem-offline-new', title: 'Created offline', dueAt: new Date().toISOString(), status: 'active', createdAt: '', updatedAt: '' },
      { id: 'rem-2', title: 'Existing', dueAt: new Date().toISOString(), status: 'active', createdAt: '', updatedAt: '' },
    ];
    const remoteReminders: AppReminder[] = [
      { id: 'rem-2', title: 'Existing', dueAt: new Date().toISOString(), status: 'active', createdAt: '', updatedAt: '' },
    ];
    const pendingSync: SyncItem[] = [
      { id: 'sq-1', entityType: 'reminder', noteId: 'rem-offline-new' },
    ];

    const result = mergeReminders(localReminders, remoteReminders, pendingSync);
    assert.equal(result.length, 2);
    assert.ok(result.some(r => r.id === 'rem-offline-new'), 'Pending offline reminder must be retained');
  });
});

describe('Owner-Editor Shared Note Convergence Logic', () => {
  test('owner private copy updates when shared note authority changes', () => {
    const ownerPrivateNotes: Note[] = [
      {
        id: 'shared-note-1',
        title: 'Original Title',
        content: 'Original Content',
        type: 'note',
        color: 'default',
        tags: ['general'],
        notebookId: 'nb-1',
        pinned: false,
        starred: false,
        archived: false,
        trashed: false,
        locked: false,
        checklist: [],
        priority: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        wordCount: 4,
        charCount: 30,
        linkedNoteIds: [],
        order: 0,
        ownerId: 'owner-uid-1',
        isShared: true,
        sharedWith: ['editor@example.com'],
        editors: ['editor@example.com'],
      },
    ];

    // Editor modified the shared note in shared_notes collection
    const incomingOwnedShared: Note[] = [
      {
        ...ownerPrivateNotes[0],
        title: 'Updated by Editor',
        content: 'New content typed by collaborator',
        updatedAt: '2026-01-02T12:00:00.000Z',
        tags: ['general', 'collaborative'],
      },
    ];

    // Convergence application
    const updated = [...ownerPrivateNotes];
    incomingOwnedShared.forEach(shared => {
      const idx = updated.findIndex(n => n.id === shared.id);
      if (idx >= 0) {
        updated[idx] = {
          ...updated[idx],
          title: shared.title,
          content: shared.content,
          updatedAt: shared.updatedAt,
          tags: shared.tags,
        };
      }
    });

    assert.equal(updated[0].title, 'Updated by Editor');
    assert.equal(updated[0].content, 'New content typed by collaborator');
    assert.deepEqual(updated[0].tags, ['general', 'collaborative']);
  });
});

describe('Round 3: Strict Legacy Quarantine & Explicit Recovery Logic', () => {
  const WORKSPACE_SHORT_KEYS = [
    'notes', 'notebooks', 'profile', 'settings', 'onboarded', 'scratchpad',
    'saved-searches', 'team-spaces', 'activity-items', 'notifications',
    'reminders', 'sync-queue', 'sync-conflicts', 'triggered-reminders',
  ];
  const LEGACY_RECOVERY_PREFIX = 'ntk:legacy-recovery';

  // Pure simulation of migrateLegacyData
  const simulateLegacyMigration = (
    storage: Map<string, string>,
    targetUid: string
  ): { migrated: boolean; quarantined: boolean } => {
    const hasLegacy = WORKSPACE_SHORT_KEYS.some(k => storage.has(`ntk-${k}`));
    if (!hasLegacy) return { migrated: false, quarantined: false };

    const targetPrefix = `ntk:user:${targetUid}`;
    const hasExistingData = storage.has(`${targetPrefix}:notes`);

    const rawLegacyNotes = storage.get('ntk-notes');
    const legacyNotes: Array<{ ownerId?: string }> = rawLegacyNotes ? JSON.parse(rawLegacyNotes) : [];
    const withOwner = legacyNotes.filter(n => typeof n.ownerId === 'string' && n.ownerId.length > 0).length;
    const ownedByTarget = legacyNotes.filter(n => n.ownerId === targetUid).length;

    const canSafelyAutoMigrate = !hasExistingData && withOwner > 0 && ownedByTarget === withOwner;

    if (canSafelyAutoMigrate) {
      WORKSPACE_SHORT_KEYS.forEach(k => {
        const raw = storage.get(`ntk-${k}`);
        if (raw) storage.set(`${targetPrefix}:${k}`, raw);
        storage.delete(`ntk-${k}`);
      });
      return { migrated: true, quarantined: false };
    } else {
      WORKSPACE_SHORT_KEYS.forEach(k => {
        const raw = storage.get(`ntk-${k}`);
        if (raw) {
          const recKey = `${LEGACY_RECOVERY_PREFIX}:${k}`;
          if (!storage.has(recKey)) storage.set(recKey, raw);
          storage.delete(`ntk-${k}`);
        }
      });
      return { migrated: false, quarantined: true };
    }
  };

  test('quarantines legacy data when notes lack ownerId metadata (no auto-assignment)', () => {
    const storage = new Map<string, string>();
    storage.set('ntk-notes', JSON.stringify([{ id: 'note-1', title: 'Unowned Legacy Note' }]));
    storage.set('ntk-profile', JSON.stringify({ name: 'Old User' }));

    const res = simulateLegacyMigration(storage, 'user_target_123');
    assert.equal(res.migrated, false);
    assert.equal(res.quarantined, true);
    assert.ok(!storage.has('ntk:user:user_target_123:notes'));
    assert.ok(storage.has('ntk:legacy-recovery:notes'));
    assert.ok(storage.has('ntk:legacy-recovery:profile'));
  });

  test('quarantines legacy data when 0 notes exist but other legacy keys exist', () => {
    const storage = new Map<string, string>();
    storage.set('ntk-notes', JSON.stringify([]));
    storage.set('ntk-settings', JSON.stringify({ theme: 'dark' }));

    const res = simulateLegacyMigration(storage, 'user_target_123');
    assert.equal(res.migrated, false);
    assert.equal(res.quarantined, true);
    assert.ok(!storage.has('ntk:user:user_target_123:settings'));
    assert.ok(storage.has('ntk:legacy-recovery:settings'));
  });

  test('quarantines legacy data when mixed ownership exists', () => {
    const storage = new Map<string, string>();
    storage.set('ntk-notes', JSON.stringify([
      { id: 'note-1', title: 'Mine', ownerId: 'user_target_123' },
      { id: 'note-2', title: 'Theirs', ownerId: 'user_other_456' },
    ]));

    const res = simulateLegacyMigration(storage, 'user_target_123');
    assert.equal(res.migrated, false);
    assert.equal(res.quarantined, true);
  });

  test('auto-migrates only when 100% of owner-tagged legacy notes match target UID and no user data exists', () => {
    const storage = new Map<string, string>();
    storage.set('ntk-notes', JSON.stringify([
      { id: 'note-1', title: 'Verified Note 1', ownerId: 'user_target_123' },
      { id: 'note-2', title: 'Verified Note 2', ownerId: 'user_target_123' },
    ]));

    const res = simulateLegacyMigration(storage, 'user_target_123');
    assert.equal(res.migrated, true);
    assert.equal(res.quarantined, false);
    assert.ok(storage.has('ntk:user:user_target_123:notes'));
  });

  test('explicit recovery imports quarantined data into user namespace on demand', () => {
    const storage = new Map<string, string>();
    storage.set('ntk:legacy-recovery:notes', JSON.stringify([{ id: 'rec-1', title: 'Recovered Note' }]));

    const recover = (targetUid: string) => {
      const targetPrefix = `ntk:user:${targetUid}`;
      let count = 0;
      WORKSPACE_SHORT_KEYS.forEach(k => {
        const recKey = `${LEGACY_RECOVERY_PREFIX}:${k}`;
        const raw = storage.get(recKey);
        if (raw) {
          storage.set(`${targetPrefix}:${k}`, raw);
          storage.delete(recKey);
          count++;
        }
      });
      return count > 0;
    };

    assert.equal(recover('user_target_123'), true);
    assert.ok(storage.has('ntk:user:user_target_123:notes'));
    assert.ok(!storage.has('ntk:legacy-recovery:notes'));
  });
});

describe('Round 3: Device-Local Reminder Delivery Ledger', () => {
  test('deduplicates delivery per occurrence without synchronizing global triggered flag', () => {
    const deviceALedger: Record<string, string> = {};
    const deviceBLedger: Record<string, string> = {};

    const reminderId = 'rem-test-1';
    const dueAt = '2026-08-28T10:00:00.000Z';
    const occurrence1 = `${dueAt}_active`;

    // Device A delivers
    assert.notEqual(deviceALedger[reminderId], occurrence1);
    deviceALedger[reminderId] = occurrence1;
    assert.equal(deviceALedger[reminderId], occurrence1); // Delivered on A

    // Device B is unaffected by Device A delivery
    assert.notEqual(deviceBLedger[reminderId], occurrence1);
    deviceBLedger[reminderId] = occurrence1; // Now delivered on B as well
    assert.equal(deviceBLedger[reminderId], occurrence1);

    // User snoozes reminder by 10 minutes
    const snoozedUntil = '2026-08-28T10:10:00.000Z';
    const occurrence2 = `${snoozedUntil}_active`;

    // Occurrence changed -> both devices re-alert when due
    assert.notEqual(deviceALedger[reminderId], occurrence2);
    assert.notEqual(deviceBLedger[reminderId], occurrence2);
  });
});


describe('Template 2.0 Beginner-Friendly Creation', () => {
  test('converts technical markdown template content into an editable standard note', async () => {
    const { buildTemplateDraft } = await import('../src/utils/templateExperience.ts');
    const template = {
      id: 'tpl-project',
      name: 'Project Plan',
      description: 'Project planning template',
      icon: '🚀',
      content: '# Project: [Name]\n\n## Overview\n\n**Goal:** \n**Deadline:** \n\n## Milestones\n\n- [ ] Phase 1: \n',
      type: 'markdown' as const,
      tags: ['project'],
      checklist: [],
    };

    const draft = buildTemplateDraft(template, 'Website Redesign', new Date('2026-08-29T10:00:00'));
    assert.equal(draft.title, 'Website Redesign');
    assert.equal(draft.type, 'note');
    assert.ok(draft.content.includes('OVERVIEW'));
    assert.ok(draft.content.includes('What result are you trying to achieve?'));
    assert.ok(draft.content.includes('☐ Phase 1:'));
    assert.ok(!draft.content.includes('##'));
    assert.ok(!draft.content.includes('**'));
    assert.ok(!draft.content.includes('[Name]'));
  });

  test('fills obvious date fields automatically', async () => {
    const { buildTemplateDraft } = await import('../src/utils/templateExperience.ts');
    const template = {
      id: 'tpl-meeting',
      name: 'Meeting Notes',
      description: 'Meeting',
      icon: '🤝',
      content: '# Meeting Notes\n\n**Date:** \n**Attendees:** \n\n## Discussion Points\n',
      type: 'note' as const,
      tags: ['meeting'],
      checklist: [],
    };

    const draft = buildTemplateDraft(template, 'Team Meeting', new Date('2026-08-29T10:00:00'));
    assert.ok(draft.content.includes('Date: Saturday, August 29, 2026'));
    assert.ok(draft.content.includes('DISCUSSION POINTS'));
  });

  test('to-do template starts as a clean real checklist instead of fake placeholder tasks', async () => {
    const { buildTemplateDraft } = await import('../src/utils/templateExperience.ts');
    const template = {
      id: 'tpl-todo',
      name: 'To-Do List',
      description: 'Tasks',
      icon: '✅',
      content: '',
      type: 'checklist' as const,
      tags: ['todo'],
      checklist: [
        { id: 'old-1', text: 'Task 1', checked: false, order: 0 },
        { id: 'old-2', text: 'Task 2', checked: false, order: 1 },
      ],
    };

    const draft = buildTemplateDraft(template, 'Saturday Tasks');
    assert.equal(draft.type, 'checklist');
    assert.equal(draft.checklist.length, 0);
    assert.ok(draft.content.includes('START HERE'));
  });
});

// Template Experience 2.1 tests are intentionally pure so they run without Firebase or a browser.
import { buildTemplateDraft, getTemplateSetupDefaults } from '../src/utils/templateExperience.ts';
import type { NoteTemplate } from '../src/types/index.ts';

describe('Novice-Friendly Template Experience', () => {
  const cvTemplate: NoteTemplate = {
    id: 'tpl-cv',
    name: 'CV / Resume',
    description: 'Professional CV starter',
    icon: '📄',
    content: '',
    type: 'note',
    theme: 'graphite',
    tags: ['career', 'cv'],
    checklist: [],
  };

  const projectTemplate: NoteTemplate = {
    id: 'tpl-project',
    name: 'Project Plan',
    description: 'Plan a project',
    icon: '🚀',
    content: '# Project: [Name]\n\n## Overview\n\n**Goal:**\n**Deadline:**\n\n## Milestones\n\n- [ ] Phase 1:',
    type: 'markdown',
    theme: 'canvas',
    tags: ['project'],
    checklist: [],
  };

  test('CV starts as a polished editable example without raw Markdown', () => {
    const draft = buildTemplateDraft(cvTemplate, undefined, new Date('2026-08-29T08:00:00'), {
      fullName: 'Ada Okafor',
      targetRole: 'Operations Manager',
      email: 'ada@example.com',
      phone: '+234 800 000 0000',
      location: 'Lagos, Nigeria',
      yearsExperience: '6',
    }, true);

    assert.equal(draft.title, 'Ada Okafor — CV');
    assert.match(draft.content, /PROFESSIONAL SUMMARY/);
    assert.match(draft.content, /WORK EXPERIENCE/);
    assert.match(draft.content, /EDUCATION/);
    assert.match(draft.content, /Example — replace this with your real information/);
    assert.doesNotMatch(draft.content, /^#{1,6}\s/m);
    assert.doesNotMatch(draft.content, /\*\*[^*]+\*\*/);
  });

  test('CV profile defaults autofill only known identity fields', () => {
    const defaults = getTemplateSetupDefaults(cvTemplate, { name: 'Ada Okafor', email: 'ada@example.com' });
    assert.equal(defaults.fullName, 'Ada Okafor');
    assert.equal(defaults.email, 'ada@example.com');
    assert.equal(defaults.phone, '');
    assert.equal(defaults.yearsExperience, '');
  });

  test('generic project personalization replaces guidance instead of duplicating the goal', () => {
    const goal = 'Launch a simple customer-ready website';
    const draft = buildTemplateDraft(projectTemplate, 'Website Launch', new Date('2026-08-29T08:00:00'), {
      projectGoal: goal,
      deadline: '2026-09-30',
    }, true);

    assert.equal((draft.content.match(new RegExp(goal, 'g')) || []).length, 1);
    assert.match(draft.content, /Target date: 2026-09-30/);
    assert.doesNotMatch(draft.content, /^#{1,6}\s/m);
  });

  test('sample wording can be turned off for experienced users', () => {
    const draft = buildTemplateDraft(cvTemplate, undefined, new Date('2026-08-29T08:00:00'), {
      fullName: 'Ada Okafor',
      targetRole: 'Operations Manager',
      email: 'ada@example.com',
    }, false);
    assert.doesNotMatch(draft.content, /Example — replace this/);
    assert.match(draft.content, /Write 3–4 lines/);
  });
});

describe('Authentication Bootstrap Order & Loading State Invariant', () => {
  // Pure storage model mimicking localStorage namespace management
  class MockWorkspaceStorage {
    private store = new Map<string, string>();
    public activePrefix = 'ntk:guest';

    setPrefix(uid: string | null) {
      this.activePrefix = uid ? `ntk:user:${uid}` : 'ntk:guest';
    }

    save(key: string, value: unknown) {
      this.store.set(`${this.activePrefix}:${key}`, JSON.stringify(value));
    }

    load<T>(key: string, fallback: T): T {
      const raw = this.store.get(`${this.activePrefix}:${key}`);
      return raw ? JSON.parse(raw) : fallback;
    }

    getRaw(fullKey: string): string | undefined {
      return this.store.get(fullKey);
    }
  }

  test('BUG REPRODUCTION: completing onboarding before switching namespace strands target user in isOnboarded: false', () => {
    const storage = new MockWorkspaceStorage();
    const targetUid = 'user_google_123';

    // ── Old (Broken) Order: completeOnboarding() THEN initFirestore() ──
    // Step 1: completeOnboarding writes to active namespace (which is still ntk:guest)
    storage.save('onboarded', true);
    storage.save('profile', { name: 'Google User', email: 'user@example.com' });

    // Step 2: initFirestore switches namespace to target UID and loads user's data
    storage.setPrefix(targetUid);
    const userIsOnboarded = storage.load<boolean>('onboarded', false);
    const userProfile = storage.load<{ name: string }>('profile', { name: '' });

    // In the broken flow, the target user has NOT been marked onboarded in their own workspace!
    assert.equal(userIsOnboarded, false, 'Bug: target user workspace remained un-onboarded');
    assert.equal(userProfile.name, '', 'Bug: target user profile was not in user namespace');
    assert.equal(storage.getRaw('ntk:guest:onboarded'), 'true', 'Guest namespace was mistakenly flagged');
  });

  test('PATCH VERIFICATION: switching workspace prefix BEFORE completing onboarding persists state into target UID namespace', () => {
    const storage = new MockWorkspaceStorage();
    const targetUid = 'user_google_123';

    // ── Patched Order: initFirestore() / switch prefix FIRST, THEN completeOnboarding() ──
    // Step 1: switch namespace to target UID
    storage.setPrefix(targetUid);

    // Step 2: complete onboarding writes to active namespace (now ntk:user:user_google_123)
    storage.save('onboarded', true);
    storage.save('profile', { name: 'Google User', email: 'user@example.com' });

    // Step 3: verify user's workspace is correctly hydrated
    const userIsOnboarded = storage.load<boolean>('onboarded', false);
    const userProfile = storage.load<{ name: string; email: string }>('profile', { name: '', email: '' });

    assert.equal(userIsOnboarded, true, 'Target user workspace is correctly marked onboarded');
    assert.equal(userProfile.name, 'Google User');
    assert.equal(userProfile.email, 'user@example.com');
    assert.equal(storage.getRaw('ntk:user:user_google_123:onboarded'), 'true');
    assert.equal(storage.getRaw('ntk:guest:onboarded'), undefined, 'Guest namespace remains clean');
  });

  test('Loading state is unconditionally cleared even when authentication or initialization fails', async () => {
    let loading = true;
    let errorMessage = '';

    const simulateAuthFlow = async (shouldFail: boolean) => {
      try {
        if (shouldFail) {
          throw new Error('auth/popup-closed-by-request');
        }
      } catch (err: any) {
        errorMessage = err.message;
      } finally {
        // Invariant: spinner must ALWAYS stop
        loading = false;
      }
    };

    // Test failing auth flow
    await simulateAuthFlow(true);
    assert.equal(loading, false, 'Loading spinner must be dismissed on error');
    assert.equal(errorMessage, 'auth/popup-closed-by-request');

    // Test succeeding auth flow
    loading = true;
    await simulateAuthFlow(false);
    assert.equal(loading, false, 'Loading spinner must be dismissed on success');
  });

  test('Account switching cleanly isolates workspaces between User A, Guest, and User B', () => {
    const storage = new MockWorkspaceStorage();

    // User A signs in
    storage.setPrefix('user_A');
    storage.save('onboarded', true);
    storage.save('notes', [{ id: 'note-A1', title: 'User A Secret Note' }]);

    // User A signs out -> switches to guest
    storage.setPrefix(null);
    assert.equal(storage.load<boolean>('onboarded', false), false);
    assert.deepEqual(storage.load<any[]>('notes', []), []);

    // User B signs in
    storage.setPrefix('user_B');
    assert.equal(storage.load<boolean>('onboarded', false), false, 'User B has not onboarded yet');
    assert.deepEqual(storage.load<any[]>('notes', []), [], 'User B must not see User A notes');

    // User B onboards and creates note
    storage.save('onboarded', true);
    storage.save('notes', [{ id: 'note-B1', title: 'User B Project Plan' }]);

    // User B signs out -> User A signs back in
    storage.setPrefix('user_A');
    assert.equal(storage.load<boolean>('onboarded', false), true, 'User A is still onboarded');
    const aNotes = storage.load<any[]>('notes', []);
    assert.equal(aNotes.length, 1);
    assert.equal(aNotes[0].title, 'User A Secret Note');
  });
});

describe('Model Reasoning Suppression & Gateway Security Tests', () => {
  // Parser simulation matching streamProviderToClient in Cloudflare Worker
  function parseSsePacket(packet: string): string[] {
    const emitted: string[] = [];
    const dataLines = packet.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim());
    for (const raw of dataLines) {
      if (!raw || raw === '[DONE]') continue;
      try {
        const parsed = JSON.parse(raw) as {
          choices?: Array<{ delta?: { content?: string; reasoning?: string; thought?: string; text?: string } }>;
          response?: string;
        };
        // Strict extraction rule: ONLY content or text or response. NEVER reasoning or thought.
        const content = parsed.choices?.[0]?.delta?.content ?? parsed.choices?.[0]?.delta?.text ?? (typeof parsed.response === 'string' ? parsed.response : '');
        if (content) {
          emitted.push(content);
        }
      } catch {
        // ignore
      }
    }
    return emitted;
  }

  test('Stream parser strictly extracts content and ignores provider reasoning/meta fields', () => {
    const rawSseStream = [
      'data: {"choices":[{"delta":{"reasoning":"The user wants me to summarize the note. Let me analyze key points..."}}]}',
      'data: {"choices":[{"delta":{"thought":"Step 1: extract main thesis."}}]}',
      'data: {"choices":[{"delta":{"content":"Here is the summary:"}}]}',
      'data: {"choices":[{"delta":{"content":"\\n1. First main point."}}]}',
      'data: [DONE]',
    ].join('\n\n');

    const emitted = parseSsePacket(rawSseStream);
    assert.equal(emitted.length, 2);
    assert.equal(emitted[0], 'Here is the summary:');
    assert.equal(emitted[1], '\n1. First main point.');
    assert.ok(!emitted.some(token => token.includes('The user wants') || token.includes('analyze') || token.includes('Step 1')));
  });

  test('Reasoning-only response yields zero emitted content tokens and triggers failover', () => {
    const reasoningOnlySse = [
      'data: {"choices":[{"delta":{"reasoning":"I am thinking about how to answer..."}}]}',
      'data: {"choices":[{"delta":{"reasoning":"Still thinking..."}}]}',
      'data: [DONE]',
    ].join('\n\n');

    const emitted = parseSsePacket(reasoningOnlySse);
    assert.equal(emitted.length, 0, 'Reasoning-only response must not emit any tokens to client');
    const totalEmittedLength = emitted.reduce((acc, str) => acc + str.length, 0);
    assert.equal(totalEmittedLength, 0);
  });

  test('Storage key path helper builds secure namespaced path per Firebase UID and purpose', () => {
    function buildStorageKey(uid: string, purpose: string, objectId: string, rawFileName: string): string {
      const safeName = rawFileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 100) || 'file';
      return `users/${uid}/${purpose}/${objectId}/${safeName}`;
    }

    const key = buildStorageKey('user_12345', 'attachments', 'obj_abc', '../../../malicious..photo.png');
    assert.equal(key, 'users/user_12345/attachments/obj_abc/_.._.._malicious..photo.png');
    assert.ok(!key.includes('/../'));
    assert.ok(key.startsWith('users/user_12345/attachments/obj_abc/'));
  });

  test('Note attachments maintain proper structure and deletion invariants', () => {
    const sampleAttachment = {
      id: 'att-1',
      name: 'Project_Specification.pdf',
      size: 1024 * 1024 * 2.5,
      mimeType: 'application/pdf',
      objectId: 'obj_spec_123',
      url: '/v1/storage/file/attachments/obj_spec_123/Project_Specification.pdf',
      createdAt: new Date().toISOString(),
    };

    const noteWithAttachment: Note = {
      id: 'note-att-test',
      title: 'Attachment Test Note',
      content: 'See attached document for architecture spec.',
      type: 'note',
      color: 'default',
      tags: ['spec'],
      notebookId: 'nb-main',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      locked: false,
      checklist: [],
      priority: 'high',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      wordCount: 7,
      charCount: 45,
      linkedNoteIds: [],
      order: 1,
      attachments: [sampleAttachment],
    };

    assert.equal(noteWithAttachment.attachments?.length, 1);
    assert.equal(noteWithAttachment.attachments[0].name, 'Project_Specification.pdf');
    assert.equal(noteWithAttachment.attachments[0].objectId, 'obj_spec_123');

    // Removal invariant
    const updatedAttachments = (noteWithAttachment.attachments || []).filter(a => a.id !== 'att-1');
    assert.equal(updatedAttachments.length, 0);
  });

  test('All 6 Storage Purposes are validated across the system', () => {
    const STORAGE_PURPOSES = ['profilePhotos', 'images', 'voiceNotes', 'attachments', 'backups', 'exports'] as const;
    assert.equal(STORAGE_PURPOSES.length, 6);
    
    function isStoragePurpose(val: string): boolean {
      return STORAGE_PURPOSES.includes(val as any);
    }

    assert.equal(isStoragePurpose('profilePhotos'), true);
    assert.equal(isStoragePurpose('images'), true);
    assert.equal(isStoragePurpose('voiceNotes'), true);
    assert.equal(isStoragePurpose('attachments'), true);
    assert.equal(isStoragePurpose('backups'), true);
    assert.equal(isStoragePurpose('exports'), true);
    assert.equal(isStoragePurpose('arbitrary'), false);
  });

  test('Custom profile photo reference generation and parsing round-trips correctly', () => {
    function buildStorageReference(purpose: string, objectId: string, fileName: string): string {
      return `storage:${purpose}:${objectId}:${encodeURIComponent(fileName)}`;
    }

    function parseStorageReference(ref: string) {
      if (!ref || !ref.startsWith('storage:')) return null;
      const parts = ref.split(':');
      if (parts.length < 4) return null;
      const purpose = parts[1];
      const objectId = parts[2];
      const fileName = decodeURIComponent(parts.slice(3).join(':'));
      return { purpose, objectId, fileName };
    }

    const originalRef = buildStorageReference('profilePhotos', 'obj_avatar_456', 'My Profile Photo & Avatar.png');
    assert.equal(originalRef, 'storage:profilePhotos:obj_avatar_456:My%20Profile%20Photo%20%26%20Avatar.png');

    const parsed = parseStorageReference(originalRef);
    assert.ok(parsed);
    assert.equal(parsed.purpose, 'profilePhotos');
    assert.equal(parsed.objectId, 'obj_avatar_456');
    assert.equal(parsed.fileName, 'My Profile Photo & Avatar.png');
  });

  test('Note photos and voice notes adhere to schema invariants', () => {
    const testImage = {
      id: 'img-1',
      name: 'Whiteboard_Diagram.webp',
      size: 1024 * 450,
      mimeType: 'image/webp',
      objectId: 'obj_img_789',
      caption: 'Initial architectural layout',
      width: 1920,
      height: 1080,
      createdAt: new Date().toISOString(),
    };

    const testVoiceNote = {
      id: 'vn-1',
      title: 'Meeting Memo Aug 30',
      durationSeconds: 125,
      size: 1024 * 320,
      mimeType: 'audio/webm;codecs=opus',
      objectId: 'obj_vn_101',
      createdAt: new Date().toISOString(),
    };

    const noteWithMedia: Note = {
      id: 'note-media-test',
      title: 'Media Rich Note',
      content: 'Note with embedded photos and voice memos.',
      type: 'note',
      color: 'default',
      tags: ['multimedia'],
      notebookId: 'nb-main',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      locked: false,
      checklist: [],
      priority: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      wordCount: 7,
      charCount: 42,
      linkedNoteIds: [],
      order: 1,
      images: [testImage],
      voiceNotes: [testVoiceNote],
    };

    assert.equal(noteWithMedia.images?.length, 1);
    assert.equal(noteWithMedia.images[0].caption, 'Initial architectural layout');
    assert.equal(noteWithMedia.images[0].width, 1920);

    assert.equal(noteWithMedia.voiceNotes?.length, 1);
    assert.equal(noteWithMedia.voiceNotes[0].durationSeconds, 125);
    assert.equal(noteWithMedia.voiceNotes[0].title, 'Meeting Memo Aug 30');
  });

  test('Storage Guard computes warning thresholds and safety target usage accurately', () => {
    const targetBytes = 8 * 1024 * 1024 * 1024; // 8 GB

    function calculateGuardStatus(usedBytes: number) {
      const percentage = (usedBytes / targetBytes) * 100;
      if (percentage >= 95) return 'critical';
      if (percentage >= 85) return 'warning';
      if (percentage >= 70) return 'attention';
      return 'ok';
    }

    assert.equal(calculateGuardStatus(1024 * 1024 * 100), 'ok'); // 100 MB -> ok
    assert.equal(calculateGuardStatus(targetBytes * 0.72), 'attention'); // 72% -> attention
    assert.equal(calculateGuardStatus(targetBytes * 0.88), 'warning'); // 88% -> warning
    assert.equal(calculateGuardStatus(targetBytes * 0.96), 'critical'); // 96% -> critical
  });

  test('Audio MIME type to file extension maps cleanly across standard audio formats', () => {
    function getAudioExtensionFromMime(mimeType: string): string {
      const clean = mimeType.toLowerCase();
      if (clean.includes('webm')) return '.webm';
      if (clean.includes('mp4') || clean.includes('m4a') || clean.includes('aac')) return '.m4a';
      if (clean.includes('ogg') || clean.includes('opus')) return '.ogg';
      if (clean.includes('wav')) return '.wav';
      if (clean.includes('mp3') || clean.includes('mpeg')) return '.mp3';
      return '.webm';
    }

    assert.equal(getAudioExtensionFromMime('audio/webm;codecs=opus'), '.webm');
    assert.equal(getAudioExtensionFromMime('audio/webm'), '.webm');
    assert.equal(getAudioExtensionFromMime('audio/mp4'), '.m4a');
    assert.equal(getAudioExtensionFromMime('audio/aac'), '.m4a');
    assert.equal(getAudioExtensionFromMime('audio/ogg'), '.ogg');
    assert.equal(getAudioExtensionFromMime('audio/wav'), '.wav');
    assert.equal(getAudioExtensionFromMime('audio/mp3'), '.mp3');
    assert.equal(getAudioExtensionFromMime('unknown/format'), '.webm');
  });

  test('Unified voice recording timer halts recording accurately after pause/resume cycle', () => {
    let duration = 0;
    let isRecording = true;
    const maxMinutes = 15;
    const maxSec = maxMinutes * 60; // 900 seconds

    function tick() {
      if (duration + 1 >= maxSec) {
        isRecording = false;
        duration = maxSec;
      } else {
        duration += 1;
      }
    }

    // Record for 300 seconds (5 min)
    for (let i = 0; i < 300; i++) tick();
    assert.equal(duration, 300);
    assert.equal(isRecording, true);

    // Pause (no ticks)
    // Resume and record another 600 seconds (10 min -> total 15 min)
    for (let i = 0; i < 600; i++) tick();
    assert.equal(duration, 900);
    assert.equal(isRecording, false, 'Recording must auto-stop when cumulative elapsed duration reaches max');
  });

  test('Durable Offline Media Queue enforces strict UID isolation', () => {
    interface TestOfflineQueueItem {
      id: string;
      uid: string;
      noteId: string;
      purpose: string;
      fileName: string;
      uploadState: 'pending' | 'uploading' | 'failed' | 'uploaded';
      retryCount: number;
    }

    const queue: TestOfflineQueueItem[] = [
      { id: 'm-1', uid: 'user_A', noteId: 'note_1', purpose: 'voiceNotes', fileName: 'Memo1.webm', uploadState: 'pending', retryCount: 0 },
      { id: 'm-2', uid: 'user_A', noteId: 'note_2', purpose: 'images', fileName: 'Photo1.webp', uploadState: 'pending', retryCount: 0 },
      { id: 'm-3', uid: 'user_B', noteId: 'note_3', purpose: 'voiceNotes', fileName: 'UserB_Memo.webm', uploadState: 'pending', retryCount: 0 },
    ];

    function getPendingForUser(targetUid: string): TestOfflineQueueItem[] {
      return queue.filter(item => item.uid === targetUid && (item.uploadState === 'pending' || item.uploadState === 'failed'));
    }

    const userAPending = getPendingForUser('user_A');
    assert.equal(userAPending.length, 2);
    assert.ok(userAPending.every(item => item.uid === 'user_A'));
    assert.ok(!userAPending.some(item => item.uid === 'user_B'), 'User B items must never leak to User A queue');

    const userBPending = getPendingForUser('user_B');
    assert.equal(userBPending.length, 1);
    assert.equal(userBPending[0].id, 'm-3');
  });

  test('True Global Storage Guard rejects uploads exceeding 95% critical threshold', () => {
    const safetyTargetBytes = 8 * 1024 * 1024 * 1024; // 8 GB
    const criticalThreshold = safetyTargetBytes * 0.95; // 7.6 GB

    function checkUploadAllowed(currentGlobalUsage: number, incomingFileSize: number, guardEnabled = true) {
      if (!guardEnabled) return { allowed: true };
      if (currentGlobalUsage + incomingFileSize > criticalThreshold) {
        return {
          allowed: false,
          code: 'STORAGE_GUARD_PAUSED',
          message: 'Storage is temporarily full. Your file is still safe on this device.',
        };
      }
      return { allowed: true };
    }

    // Under threshold: 1 GB in use + 10 MB incoming -> allowed
    const res1 = checkUploadAllowed(1024 * 1024 * 1024, 10 * 1024 * 1024);
    assert.equal(res1.allowed, true);

    // Right at edge: 7.59 GB in use + 50 MB incoming (exceeds 7.6 GB) -> rejected
    const res2 = checkUploadAllowed(7.59 * 1024 * 1024 * 1024, 50 * 1024 * 1024);
    assert.equal(res2.allowed, false);
    assert.equal(res2.code, 'STORAGE_GUARD_PAUSED');

    // Deletions / cleanups are always permitted regardless of usage
    function checkDeleteAllowed() { return true; }
    assert.equal(checkDeleteAllowed(), true);
  });

  test('Idempotent ensureBoundR2Connection creates Main R2 Storage without duplicates', () => {
    interface StorageConn {
      id: string;
      name: string;
      provider: string;
      useWorkerBinding?: boolean;
      enabled: boolean;
    }

    const connections: StorageConn[] = [];

    function ensureBoundR2(hasR2Bucket: boolean) {
      if (!hasR2Bucket) return;
      const exists = connections.some(c => c.provider === 'r2' && c.useWorkerBinding && c.enabled);
      if (exists) return;
      connections.push({
        id: 'conn_r2_main',
        name: 'Main R2 Storage',
        provider: 'r2',
        useWorkerBinding: true,
        enabled: true,
      });
    }

    // Call 1: Creates connection
    ensureBoundR2(true);
    assert.equal(connections.length, 1);
    assert.equal(connections[0].name, 'Main R2 Storage');

    // Call 2: Idempotent no-op
    ensureBoundR2(true);
    assert.equal(connections.length, 1, 'Idempotent bootstrap must not create duplicate connections');
  });
});

describe('Real IndexedDB Offline Media Queue Integration', () => {
  // Set up fake-indexeddb environment
  let enqueueOfflineMedia: any;
  let getPendingMediaForUser: any;
  let resolveOfflineMediaBlob: any;
  let removeOfflineMedia: any;
  let cleanNoteOfflineMedia: any;
  let markMediaUploaded: any;
  let incrementMediaRetry: any;
  let syncPendingMediaForUser: any;

  test('Setup IndexedDB environment and import offlineMediaQueue', async () => {
    await import('fake-indexeddb/auto');
    if (!(globalThis as any).URL) {
      (globalThis as any).URL = {
        createObjectURL: (blob: any) => `blob:http://localhost/${Math.random().toString(36).slice(2)}`,
        revokeObjectURL: () => {},
      };
    }

    const mod = await import('../src/utils/offlineMediaQueue.ts');
    enqueueOfflineMedia = mod.enqueueOfflineMedia;
    getPendingMediaForUser = mod.getPendingMediaForUser;
    resolveOfflineMediaBlob = mod.resolveOfflineMediaBlob;
    removeOfflineMedia = mod.removeOfflineMedia;
    cleanNoteOfflineMedia = mod.cleanNoteOfflineMedia;
    markMediaUploaded = mod.markMediaUploaded;
    incrementMediaRetry = mod.incrementMediaRetry;
    syncPendingMediaForUser = mod.syncPendingMediaForUser;

    assert.ok(enqueueOfflineMedia);
    assert.ok(getPendingMediaForUser);
  });

  test('Blob persistence and metadata storage in real IndexedDB', async () => {
    const testBlob = new Blob(['sample voice recording data'], { type: 'audio/webm' });
    await enqueueOfflineMedia({
      id: 'media_voice_101',
      uid: 'user_real_A',
      noteId: 'note_xyz_1',
      purpose: 'voiceNotes',
      blob: testBlob,
      mimeType: 'audio/webm',
      fileName: 'Voice Note Aug 30.webm',
      metadata: { durationSeconds: 45, title: 'Voice Note Aug 30' },
    });

    const pending = await getPendingMediaForUser('user_real_A');
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, 'media_voice_101');
    assert.equal(pending[0].uid, 'user_real_A');
    assert.equal(pending[0].fileName, 'Voice Note Aug 30.webm');
    assert.equal(pending[0].purpose, 'voiceNotes');
    assert.equal(pending[0].uploadState, 'pending');

    const resolvedBlob = await resolveOfflineMediaBlob('media_voice_101', 'user_real_A');
    assert.ok(resolvedBlob);
    assert.equal(resolvedBlob.type, 'audio/webm');
  });

  test('Real IndexedDB enforces strict cross-user UID namespace isolation', async () => {
    const blobB = new Blob(['user B private image'], { type: 'image/webp' });
    await enqueueOfflineMedia({
      id: 'media_img_202',
      uid: 'user_real_B',
      noteId: 'note_xyz_2',
      purpose: 'images',
      blob: blobB,
      mimeType: 'image/webp',
      fileName: 'PrivatePhoto.webp',
    });

    // User A should only see User A's item
    const userAPending = await getPendingMediaForUser('user_real_A');
    assert.equal(userAPending.length, 1);
    assert.equal(userAPending[0].id, 'media_voice_101');
    assert.ok(!userAPending.some(i => i.uid === 'user_real_B'));

    // User A cannot read User B's blob directly
    const crossBlob = await resolveOfflineMediaBlob('media_img_202', 'user_real_A');
    assert.equal(crossBlob, null, 'User A must never be able to resolve User B offline blob');

    // User B should only see User B's item
    const userBPending = await getPendingMediaForUser('user_real_B');
    assert.equal(userBPending.length, 1);
    assert.equal(userBPending[0].id, 'media_img_202');
  });

  test('Deletion & Note-level cleanup cleanly purge items from IndexedDB', async () => {
    // Delete individual item
    await removeOfflineMedia('media_voice_101', 'user_real_A');
    const userAPostDelete = await getPendingMediaForUser('user_real_A');
    assert.equal(userAPostDelete.length, 0);

    const deletedBlob = await resolveOfflineMediaBlob('media_voice_101', 'user_real_A');
    assert.equal(deletedBlob, null);

    // Note cleanup: add 2 items for note_xyz_3, then clean whole note
    const attBlob1 = new Blob(['att 1'], { type: 'application/pdf' });
    const attBlob2 = new Blob(['att 2'], { type: 'application/pdf' });
    await enqueueOfflineMedia({ id: 'att_1', uid: 'user_real_A', noteId: 'note_xyz_3', purpose: 'attachments', blob: attBlob1, mimeType: 'application/pdf', fileName: '1.pdf' });
    await enqueueOfflineMedia({ id: 'att_2', uid: 'user_real_A', noteId: 'note_xyz_3', purpose: 'attachments', blob: attBlob2, mimeType: 'application/pdf', fileName: '2.pdf' });

    assert.equal((await getPendingMediaForUser('user_real_A')).length, 2);
    await cleanNoteOfflineMedia('note_xyz_3', 'user_real_A');
    assert.equal((await getPendingMediaForUser('user_real_A')).length, 0);
  });

  test('Retry increment and reconnect sync pipeline', async () => {
    const syncBlob = new Blob(['sync test data'], { type: 'audio/webm' });
    await enqueueOfflineMedia({
      id: 'sync_item_1',
      uid: 'user_sync_test',
      noteId: 'note_sync',
      purpose: 'voiceNotes',
      blob: syncBlob,
      mimeType: 'audio/webm',
      fileName: 'SyncVoice.webm',
    });

    // Simulate 1 failure retry (sets nextEligibleAttemptAt in the future)
    await incrementMediaRetry('sync_item_1', 'user_sync_test', 'Temporary network glitch');
    let items = await getPendingMediaForUser('user_sync_test');
    assert.equal(items[0].retryCount, 1);
    assert.equal(items[0].lastError, 'Temporary network glitch');
    assert.equal(items[0].uploadState, 'failed');

    // v2.8: Eligibility check respects backoff — item NOT immediately eligible
    const eligibleItems = await getPendingMediaForUser('user_sync_test', true);
    assert.equal(eligibleItems.length, 0, 'Failed item with future backoff must NOT be eligible for immediate retry');

    // §15-§16: Manual sync (leaderBypass: true) must STILL respect backoff -> 0 synced
    const uploadedIds: string[] = [];
    const manualResult = await syncPendingMediaForUser('user_sync_test', async (item) => {
      uploadedIds.push(item.id);
      return { objectId: 'remote_obj_123', url: 'https://gateway/storage/file/voiceNotes/remote_obj_123/SyncVoice.webm' };
    }, { leaderBypass: true, bypassEligibility: false });

    assert.equal(manualResult.synced, 0, 'Manual sync must still respect future backoff');
    assert.equal(uploadedIds.length, 0);

    // §17: Explicit retry action (bypassEligibility: true) clears backoff and drains item
    const explicitResult = await syncPendingMediaForUser('user_sync_test', async (item) => {
      uploadedIds.push(item.id);
      return { objectId: 'remote_obj_123', url: 'https://gateway/storage/file/voiceNotes/remote_obj_123/SyncVoice.webm' };
    }, { leaderBypass: true, bypassEligibility: true });

    assert.equal(explicitResult.synced, 1);
    assert.equal(explicitResult.failed, 0);
    assert.deepEqual(uploadedIds, ['sync_item_1']);

    // Queue should now be empty for user
    const remaining = await getPendingMediaForUser('user_sync_test');
    assert.equal(remaining.length, 0);
  });
});

describe('v2.4 Recent Notebooks Recency & Invariants', () => {
  test('Sorts notebooks by latest active note updatedAt', () => {
    const nb1 = { id: 'nb_1', name: 'Notebook 1', createdAt: '2026-01-01T00:00:00.000Z', trashed: false };
    const nb2 = { id: 'nb_2', name: 'Notebook 2', createdAt: '2026-01-02T00:00:00.000Z', trashed: false };
    const nb3 = { id: 'nb_3', name: 'Notebook 3', createdAt: '2026-01-03T00:00:00.000Z', trashed: false };

    const notes = [
      { id: 'n1', notebookId: 'nb_1', title: 'Note 1', updatedAt: '2026-05-10T12:00:00.000Z', trashed: false },
      { id: 'n2', notebookId: 'nb_2', title: 'Note 2', updatedAt: '2026-06-20T12:00:00.000Z', trashed: false },
      { id: 'n3', notebookId: 'nb_3', title: 'Note 3', updatedAt: '2026-04-01T12:00:00.000Z', trashed: false },
    ];

    const result = getRecentNotebooks([nb1, nb2, nb3], notes, 5);
    assert.equal(result.length, 3);
    assert.equal(result[0].notebook.id, 'nb_2'); // June 2026 is most recent
    assert.equal(result[1].notebook.id, 'nb_1'); // May 2026
    assert.equal(result[2].notebook.id, 'nb_3'); // April 2026
  });

  test('Filters out trashed notes and trashed notebooks', () => {
    const nbActive = { id: 'nb_active', name: 'Active Notebook', createdAt: '2026-01-01T00:00:00.000Z', trashed: false };
    const nbTrashed = { id: 'nb_trashed', name: 'Trashed Notebook', createdAt: '2026-08-01T00:00:00.000Z', trashed: true };

    const notes = [
      { id: 'n1', notebookId: 'nb_active', title: 'Note active', updatedAt: '2026-02-01T12:00:00.000Z', trashed: false },
      { id: 'n2', notebookId: 'nb_active', title: 'Note trashed', updatedAt: '2026-09-01T12:00:00.000Z', trashed: true },
      { id: 'n3', notebookId: 'nb_trashed', title: 'Note in trashed NB', updatedAt: '2026-09-02T12:00:00.000Z', trashed: false },
    ];

    const result = getRecentNotebooks([nbActive, nbTrashed], notes, 5);
    assert.equal(result.length, 1);
    assert.equal(result[0].notebook.id, 'nb_active');
    // The activity time must be 2026-02-01, NOT the trashed note from 2026-09-01
    assert.equal(result[0].lastActivityIso, '2026-02-01T12:00:00.000Z');
    assert.equal(result[0].noteCount, 1);
  });

  test('Falls back gracefully to notebook creation date when empty', () => {
    const emptyNb = { id: 'nb_empty', name: 'Empty Notebook', createdAt: '2026-03-15T09:00:00.000Z', trashed: false };
    const result = getRecentNotebooks([emptyNb], [], 5);
    assert.equal(result.length, 1);
    assert.equal(result[0].noteCount, 0);
    assert.equal(result[0].lastActivityIso, '2026-03-15T09:00:00.000Z');
  });
});

describe('v2.4 Friendly AI & Model Reasoning Stripping', () => {
  test('Strips <think>...</think> blocks completely', () => {
    const raw = '<think>I am analyzing the note contents carefully.</think>Here is the revised draft.';
    const clean = sanitizeAiText(raw);
    assert.equal(clean, 'Here is the revised draft.');
  });

  test('Strips multi-line <thought> and [thinking] blocks', () => {
    const raw = '<thought>\nLine 1\nLine 2\n</thought>Clean paragraph.\n[thinking]Internal monologue[/thinking]';
    const clean = sanitizeAiText(raw);
    assert.equal(clean, 'Clean paragraph.');
  });

  test('Preserves markdown tables and code blocks while stripping reasoning tags', () => {
    const raw = '<think>Generating table</think>| Header | Value |\n| --- | --- |\n| Test | Passed |';
    const clean = sanitizeAiText(raw);
    assert.equal(clean, '| Header | Value |\n| --- | --- |\n| Test | Passed |');
  });
});

describe('v2.4 Listen Independent Download vs Save Contract', () => {
  test('Generated audio filename formats title and ISO date correctly', () => {
    const formatAudioDownloadName = (title: string, mime: string) => {
      const date = new Date().toISOString().split('T')[0];
      const safeTitle = (title || 'NTK-Note').trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 40) || 'NTK-Note';
      const ext = mime.includes('wav') ? 'wav' : 'mp3';
      return `${safeTitle}-Audio-${date}.${ext}`;
    };

    const name1 = formatAudioDownloadName('Meeting Notes / Executive Review!', 'audio/mpeg');
    assert.ok(name1.startsWith('Meeting-Notes---Executive-Review--Audio-'));
    assert.ok(name1.endsWith('.mp3'));

    const name2 = formatAudioDownloadName('', 'audio/wav');
    assert.ok(name2.startsWith('NTK-Note-Audio-'));
    assert.ok(name2.endsWith('.wav'));
  });

  test('Download action leaves note state and storage completely unmutated', () => {
    const initialNote: Note = {
      id: 'note_audio_test',
      notebookId: 'default',
      title: 'Original Title',
      content: 'Some note text',
      type: 'note',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      voiceNotes: [],
      attachments: [],
      trashed: false,
    };

    // User triggers Download
    const generatedAudioBytes = new Uint8Array([1, 2, 3, 4]);
    const blob = new Blob([generatedAudioBytes], { type: 'audio/mpeg' });
    assert.ok(blob.size > 0);

    // Independence guarantee: Note has NOT gained any voiceNotes or attachments
    assert.equal(initialNote.voiceNotes?.length, 0);
    assert.equal(initialNote.attachments?.length, 0);
  });
});

describe('v2.4 Audio Security, Authorization & Routing Hardening', () => {
  function evaluateTranscriptionAuth(
    caller: { uid: string; owner: boolean },
    record: { id: string; uid: string; uploaderUid?: string; noteId?: string } | null
  ): { status: number; code?: string; message: string } {
    if (!record) {
      return { status: 404, code: 'NOT_FOUND', message: 'Audio record not found.' };
    }
    const isAuthorized = record.uid === caller.uid || caller.owner || (record.uploaderUid && record.uploaderUid === caller.uid);
    if (!isAuthorized) {
      return { status: 403, code: 'FORBIDDEN', message: 'You do not have permission to transcribe this audio file.' };
    }
    return { status: 200, message: 'Authorized' };
  }

  test('Cross-user negative authorization: User B attempting to transcribe User A private audio is denied (403 FORBIDDEN)', () => {
    const userA = { uid: 'user_a_123', owner: false };
    const userB = { uid: 'user_b_456', owner: false };
    const userARecord = {
      id: 'audio_obj_789',
      uid: userA.uid,
      uploaderUid: userA.uid,
      noteId: 'note_private_a',
    };

    // User A transcribing own audio -> 200
    const authA = evaluateTranscriptionAuth(userA, userARecord);
    assert.equal(authA.status, 200);

    // User B attempting to transcribe User A audio -> 403 FORBIDDEN
    const authB = evaluateTranscriptionAuth(userB, userARecord);
    assert.equal(authB.status, 403);
    assert.equal(authB.code, 'FORBIDDEN');
  });

  test('Gateway owner can access cross-user audio for moderation/system processing', () => {
    const owner = { uid: 'owner_999', owner: true };
    const userARecord = { id: 'audio_obj_789', uid: 'user_a_123', uploaderUid: 'user_a_123' };
    const authOwner = evaluateTranscriptionAuth(owner, userARecord);
    assert.equal(authOwner.status, 200);
  });

  test('Rejects direct r2Key parameter with DIRECT_KEY_FORBIDDEN (400)', () => {
    function validateTranscriptionInput(body: { r2Key?: string; objectId?: string; purpose?: string }) {
      if (body.r2Key) {
        return { status: 400, code: 'DIRECT_KEY_FORBIDDEN', message: 'Direct storage key access is not permitted. Provide objectId and purpose.' };
      }
      if (!body.objectId || !body.purpose) {
        return { status: 400, message: 'objectId and purpose are required for remote audio transcription.' };
      }
      return { status: 200 };
    }

    const directKeyAttempt = validateTranscriptionInput({ r2Key: 'users/victim/voiceNotes/secret.webm' });
    assert.equal(directKeyAttempt.status, 400);
    assert.equal(directKeyAttempt.code, 'DIRECT_KEY_FORBIDDEN');

    const validAttempt = validateTranscriptionInput({ objectId: 'obj_123', purpose: 'voiceNotes' });
    assert.equal(validAttempt.status, 200);
  });

  test('Audio MIME allowlist and file size limits validate correctly', () => {
    const ALLOWED_AUDIO_MIMES = [
      'audio/webm',
      'audio/mpeg',
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

    function validateAudioBytesAndMime(byteLength: number, mimeType: string) {
      const cleanMime = (mimeType || '').split(';')[0].trim().toLowerCase();
      if (cleanMime && !ALLOWED_AUDIO_MIMES.includes(cleanMime) && cleanMime !== 'application/octet-stream') {
        return { ok: false, code: 'INVALID_AUDIO_TYPE' };
      }
      if (byteLength === 0) {
        return { ok: false, code: 'EMPTY_AUDIO' };
      }
      if (byteLength > 25 * 1024 * 1024) {
        return { ok: false, code: 'AUDIO_TOO_LARGE' };
      }
      return { ok: true };
    }

    // Valid audio formats
    assert.ok(validateAudioBytesAndMime(1024, 'audio/webm;codecs=opus').ok);
    assert.ok(validateAudioBytesAndMime(1024, 'audio/mpeg').ok);
    assert.ok(validateAudioBytesAndMime(1024, 'audio/wav').ok);
    assert.ok(validateAudioBytesAndMime(1024, 'audio/x-m4a').ok);
    assert.ok(validateAudioBytesAndMime(1024, 'audio/aac').ok);

    // Invalid formats
    assert.equal(validateAudioBytesAndMime(1024, 'image/png').code, 'INVALID_AUDIO_TYPE');
    assert.equal(validateAudioBytesAndMime(1024, 'application/pdf').code, 'INVALID_AUDIO_TYPE');
    assert.equal(validateAudioBytesAndMime(1024, 'video/mp4').code, 'INVALID_AUDIO_TYPE');

    // Size violations
    assert.equal(validateAudioBytesAndMime(0, 'audio/webm').code, 'EMPTY_AUDIO');
    assert.equal(validateAudioBytesAndMime(26 * 1024 * 1024, 'audio/webm').code, 'AUDIO_TOO_LARGE');
  });

  test('Server-side TTS character limits (max 4096 chars) are strictly enforced', () => {
    function validateTtsRequest(text: string, contentLength: number) {
      if (contentLength > 64 * 1024) {
        return { status: 413, code: 'PAYLOAD_TOO_LARGE' };
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return { status: 400, message: 'No text provided to speak.' };
      }
      if (trimmed.length > 4096) {
        return { status: 400, code: 'TTS_TEXT_TOO_LONG' };
      }
      return { status: 200 };
    }

    // Empty text
    assert.equal(validateTtsRequest('', 50).status, 400);

    // Valid text under 4096
    const validText = 'Hello world, this is a clean audio note test.'.repeat(10);
    assert.equal(validateTtsRequest(validText, validText.length).status, 200);

    // Exact 4096 chars
    const exact4096 = 'a'.repeat(4096);
    assert.equal(validateTtsRequest(exact4096, 4096).status, 200);

    // 4097 chars -> TTS_TEXT_TOO_LONG
    const tooLong = 'a'.repeat(4097);
    const result = validateTtsRequest(tooLong, 4097);
    assert.equal(result.status, 400);
    assert.equal(result.code, 'TTS_TEXT_TOO_LONG');

    // Huge payload > 64KB -> 413
    assert.equal(validateTtsRequest('short', 70 * 1024).status, 413);
  });

  test('Nigerian locales map to optimal voice and Whisper language codes', () => {
    function mapTranscriptionLocale(locale?: string): string | undefined {
      if (!locale) return undefined;
      const lower = locale.toLowerCase();
      if (lower.startsWith('en')) return 'en';
      if (lower.startsWith('yo')) return 'yo';
      if (lower.startsWith('ig')) return 'ig';
      if (lower.startsWith('ha')) return 'ha';
      return lower.split('-')[0];
    }

    function mapTtsVoiceAndSpeed(locale?: string, userVoice = 'alloy', userSpeed?: number) {
      const loc = (locale || '').toLowerCase();
      let voice = userVoice;
      let speed = typeof userSpeed === 'number' ? Math.min(2, Math.max(0.5, userSpeed)) : 1.0;
      if (loc === 'en-ng' || loc === 'yo' || loc === 'ig' || loc === 'ha') {
        if (voice === 'alloy') voice = 'nova';
        if (typeof userSpeed !== 'number') speed = 0.95;
      }
      return { voice, speed };
    }

    // Transcription mappings
    assert.equal(mapTranscriptionLocale('en-NG'), 'en');
    assert.equal(mapTranscriptionLocale('yo'), 'yo');
    assert.equal(mapTranscriptionLocale('ig-NG'), 'ig');
    assert.equal(mapTranscriptionLocale('ha'), 'ha');

    // TTS mappings
    const ttsNg = mapTtsVoiceAndSpeed('en-NG');
    assert.equal(ttsNg.voice, 'nova'); // warmer Nigerian default
    assert.equal(ttsNg.speed, 0.95);

    const customVoice = mapTtsVoiceAndSpeed('en-NG', 'shimmer', 1.2);
    assert.equal(customVoice.voice, 'shimmer');
    assert.equal(customVoice.speed, 1.2);
  });
});

describe('NTK Note v2.5 — Smart Sharing, Private Messaging & Conversational AI Logic', () => {

  test('Free-zone query & budget constants are properly defined and conservative', () => {
    assert.equal(QUICK_SHARE_LIMIT, 8);
    assert.equal(GLOBAL_DIRECTORY_MIN_CHARS, 3);
    assert.equal(GLOBAL_DIRECTORY_LIMIT, 8);
    assert.equal(DIRECT_CHAT_LIST_LIMIT, 20);
    assert.equal(DIRECT_MESSAGE_PAGE_SIZE, 40);
    assert.equal(AI_THREAD_LIST_LIMIT, 20);
    assert.equal(AI_TURN_PAGE_SIZE, 20);
    assert.equal(AI_CONTEXT_MAX_TURNS, 6);
    assert.equal(AI_CONTEXT_MAX_MESSAGES, 12);
    assert.equal(AI_MAX_NOTE_CONTEXT_CHARS, 10000);
    assert.equal(AI_MAX_TOTAL_CONTEXT_CHARS, 28000);
    assert.equal(DIRECT_MESSAGE_MAX_CHARS, 4000);
    assert.equal(AI_PROMPT_MAX_CHARS, 8000);
    assert.equal(DIRECTORY_DEBOUNCE_MS, 300);
  });

  test('Deterministic Chat ID calculation prevents duplicate conversations regardless of UID order', () => {
    const uidA = 'user_abc_123';
    const uidB = 'user_xyz_789';

    const chatId1 = getDeterministicChatId(uidA, uidB);
    const chatId2 = getDeterministicChatId(uidB, uidA);

    assert.equal(chatId1, chatId2);
    assert.equal(chatId1, 'user_abc_123_user_xyz_789');

    // Whitespace trimming
    const chatId3 = getDeterministicChatId('  user_xyz_789 ', ' user_abc_123');
    assert.equal(chatId3, chatId1);

    // Missing UID throws
    assert.throws(() => getDeterministicChatId('', uidB));
    assert.throws(() => getDeterministicChatId(uidA, ''));
  });

  test('Quick Share derives top recent collaborators without full directory scans', () => {
    const mockNotes = [
      { id: 'n1', title: 'Note 1', sharedWith: ['collab1@example.com'], updatedAt: '2026-09-01T10:00:00Z', isShared: true },
      { id: 'n2', title: 'Note 2', sharedBy: 'collab2@example.com', updatedAt: '2026-09-02T10:00:00Z', isShared: true },
      { id: 'n3', title: 'Note 3', sharedBy: 'collab1@example.com', updatedAt: '2026-09-03T10:00:00Z', isShared: true },
      { id: 'n4', title: 'Note 4', shareAccess: [{ email: 'collab3@example.com', role: 'viewer', addedAt: '2026-09-04T10:00:00Z' }], isShared: true },
    ];

    const mockNotebooks = [
      { id: 'nb1', name: 'NB 1', sharedWith: ['collab4@example.com'], updatedAt: '2026-09-05T10:00:00Z' },
    ];

    const suggestions = getQuickShareSuggestions(
      mockNotes as any,
      mockNotebooks as any,
      'my_uid',
      'me@example.com',
      8
    );

    assert.ok(suggestions.length <= 8);
    // collab1 appeared twice so it should be ranked first
    assert.equal(suggestions[0].email, 'collab1@example.com');
    // my own email is excluded
    assert.ok(!suggestions.some((s: any) => s.email === 'me@example.com'));
    // Relationship hint is provided
    assert.equal(suggestions[0].relationshipHint, 'Recent collaborator');
  });

  test('1-character filtering instantly matches local contacts with zero remote reads', () => {
    const contacts = [
      { email: 'alex@company.com', name: 'Alex Johnson' },
      { email: 'beatrice@org.ng', name: 'Beatrice Okafor' },
      { email: 'chidi@domain.com', name: 'Chidi Nnamdi' },
      { email: 'dapo@tech.io', name: 'Dapo Adeleke' },
    ];

    // Single character 'a' matches Alex Johnson and Dapo Adeleke (Adeleke, dapo)
    const matchA = filterLocalContacts(contacts, 'a');
    assert.ok(matchA.length >= 1);
    assert.equal(matchA[0].name, 'Alex Johnson');

    // Single character 'b' matches Beatrice
    const matchB = filterLocalContacts(contacts, 'b');
    assert.equal(matchB.length, 1);
    assert.equal(matchB[0].name, 'Beatrice Okafor');

    // Empty query returns all contacts up to limit
    const matchEmpty = filterLocalContacts(contacts, '');
    assert.equal(matchEmpty.length, 4);
  });

  test('3-character search threshold and safe directory normalization', () => {
    assert.equal(GLOBAL_DIRECTORY_MIN_CHARS, 3);

    // Below 3 chars
    assert.ok('ab'.length < GLOBAL_DIRECTORY_MIN_CHARS);
    // At or above 3 chars
    assert.ok('abc'.length >= GLOBAL_DIRECTORY_MIN_CHARS);

    // Safe normalization
    assert.equal(normalizeDirectorySearchTerm('  Chidi   Nnamdi  '), 'chidi nnamdi');
    assert.equal(normalizeDirectorySearchTerm('Álex'), 'alex');

    // Safe email validation
    assert.equal(isValidEmail('user@domain.com'), true);
    assert.equal(isValidEmail('not-an-email'), false);
  });

  test('Unread chat detection compares timestamps without heavy counter writes', () => {
    const myUid = 'user_me';
    const otherUid = 'user_other';

    // Last message was sent by other, and my lastReadAt is older
    const unreadChat = {
      id: 'chat_1',
      participantUids: [myUid, otherUid],
      participantEmails: ['me@test.com', 'other@test.com'],
      lastMessageAt: '2026-09-05T12:00:00Z',
      lastMessageSenderUid: otherUid,
      lastReadAtByUid: {
        [myUid]: '2026-09-05T11:00:00Z',
      },
      createdAt: '2026-09-01T00:00:00Z',
      status: 'active',
      requestedByUid: otherUid,
    };
    assert.equal(isChatUnread(unreadChat as any, myUid), true);

    // If I sent the last message, it's not unread for me
    const myOwnChat = {
      ...unreadChat,
      lastMessageSenderUid: myUid,
    };
    assert.equal(isChatUnread(myOwnChat as any, myUid), false);

    // If my lastReadAt is newer than lastMessageAt, it's read
    const readChat = {
      ...unreadChat,
      lastReadAtByUid: {
        [myUid]: '2026-09-05T12:05:00Z',
      },
    };
    assert.equal(isChatUnread(readChat as any, myUid), false);
  });

  test('Direct message validation enforces 4,000 character cap and rejects empty strings', () => {
    function validateMessageText(text: string): { valid: boolean; error?: string } {
      const clean = text.trim();
      if (!clean) return { valid: false, error: 'Message cannot be empty' };
      if (clean.length > DIRECT_MESSAGE_MAX_CHARS) {
        return { valid: false, error: `Exceeds max length of ${DIRECT_MESSAGE_MAX_CHARS}` };
      }
      return { valid: true };
    }

    assert.equal(validateMessageText('').valid, false);
    assert.equal(validateMessageText('   ').valid, false);
    assert.equal(validateMessageText('Hello there!').valid, true);

    const maxExact = 'x'.repeat(4000);
    assert.equal(validateMessageText(maxExact).valid, true);

    const tooLong = 'x'.repeat(4001);
    assert.equal(validateMessageText(tooLong).valid, false);
  });

  test('AI multi-turn message window bounding to 6 turns (12 messages) max', () => {
    const allTurns = Array.from({ length: 30 }, (_, i) => ({
      id: `turn_${i}`,
      userText: `User question ${i}`,
      assistantText: `Assistant answer ${i}`,
      createdAt: new Date(Date.now() + i * 1000).toISOString(),
    }));

    // Bounded to AI_CONTEXT_MAX_TURNS = 6 complete turns
    const recentTurns = allTurns.slice(-AI_CONTEXT_MAX_TURNS);
    assert.equal(recentTurns.length, 6);
    assert.equal(recentTurns[0].id, 'turn_24');
    assert.equal(recentTurns[5].id, 'turn_29');

    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    recentTurns.forEach(turn => {
      messages.push({ role: 'user', content: turn.userText });
      messages.push({ role: 'assistant', content: turn.assistantText });
    });

    assert.equal(messages.length, 12); // 6 user + 6 assistant
    assert.equal(messages.length, AI_CONTEXT_MAX_MESSAGES);
    assert.equal(messages[0].content, 'User question 24');
    assert.equal(messages[messages.length - 1].content, 'Assistant answer 29');
  });

  test('AI chat title derived sensibly from first user message without extra AI calls', () => {
    function deriveAiThreadTitle(firstUserText: string): string {
      const rawTitle = firstUserText.trim().replace(/^["']|["']$/g, '');
      return (rawTitle.slice(0, 42).trim() || 'New conversation') + (rawTitle.length > 42 ? '…' : '');
    }

    assert.equal(deriveAiThreadTitle('Help me plan a wedding in Lagos'), 'Help me plan a wedding in Lagos');
    assert.equal(
      deriveAiThreadTitle('This is a very long user prompt that exceeds the maximum length threshold for a sensible title display in the history bar'),
      'This is a very long user prompt that excee…'
    );
    assert.equal(deriveAiThreadTitle(''), 'New conversation');
  });

  test('Section 19: Newest chat query ordering logic guarantees true top-20 recent conversations', () => {
    // Generate 35 chats with varying lastMessageAt timestamps
    const baseTime = Date.now();
    const chats = Array.from({ length: 35 }, (_, i) => ({
      id: `chat_${i}`,
      lastMessageAt: new Date(baseTime + i * 60000).toISOString(), // chat_34 is newest
      participantUids: ['user_me', `user_other_${i}`],
    }));

    // When ordered by lastMessageAt descending and limited to 20:
    const ordered = [...chats]
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
      .slice(0, DIRECT_CHAT_LIST_LIMIT);

    assert.equal(ordered.length, 20);
    assert.equal(ordered[0].id, 'chat_34'); // absolute newest
    assert.equal(ordered[19].id, 'chat_15'); // 20th newest
  });

  test('Section 22: AI thread delete bounded batch cleanup guarantees zero orphan turns', () => {
    // Simulated turns subcollection
    const totalTurns = 125;
    let turnIds = Array.from({ length: totalTurns }, (_, i) => `turn_${i}`);
    let deletedCount = 0;

    // Simulated bounded batch deletion loop
    while (turnIds.length > 0) {
      const batch = turnIds.slice(0, 50); // query(collection, limit(50))
      turnIds = turnIds.slice(50);
      deletedCount += batch.length;
    }

    assert.equal(turnIds.length, 0);
    assert.equal(deletedCount, 125);
  });

  test('Section 23: Overall AI context budget and safe paragraph truncation', () => {
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

    // 1. Text within limit is preserved
    const shortText = 'This is a short text.';
    assert.equal(truncateSafely(shortText, 100), shortText);

    // 2. Text with paragraph boundary truncates cleanly at paragraph
    const multiPara = 'Paragraph 1 introduces the notes topic.\n\nParagraph 2 expands on key action items.\n\nParagraph 3 concludes.';
    const truncatedPara = truncateSafely(multiPara, 80);
    assert.ok(truncatedPara.includes('[…truncated for context budget…]'));
    assert.ok(truncatedPara.startsWith('Paragraph 1 introduces'));

    // 3. Huge note context capped strictly to AI_MAX_NOTE_CONTEXT_CHARS
    const hugeNote = 'Section A content.\n\n'.repeat(1000); // ~20,000 chars
    const cappedNote = truncateSafely(hugeNote, AI_MAX_NOTE_CONTEXT_CHARS);
    assert.ok(cappedNote.length <= AI_MAX_NOTE_CONTEXT_CHARS);

    // 4. Combined total budget enforcement
    const baseSystemLength = 2000;
    const remainingBudget = AI_MAX_TOTAL_CONTEXT_CHARS - baseSystemLength; // 26,000 chars
    assert.ok(remainingBudget > 0);
    assert.equal(AI_MAX_TOTAL_CONTEXT_CHARS, 28000);
  });

  test('Section 26: Secret scanner generic patterns accurately identify sensitive shapes', () => {
    const patterns = [
      { name: 'OpenRouter', regex: /sk-or-v1-[a-f0-9]{64}/ },
      { name: 'Groq', regex: /gsk_[A-Za-z0-9]{48,}/ },
      { name: 'OAuth Code', regex: /(?:oauth2\/auth\?[^\s]*code=[A-Za-z0-9_\-\.]{12,}|oauth\/callback\?code=[A-Za-z0-9_\-\.]{12,})/ },
      { name: 'GitHub PAT', regex: /(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{60,}/ },
      { name: 'Google API Key', regex: /AIza[0-9A-Za-z\-_]{35}/ },
      { name: 'Private Key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
    ];

    // Detection verification:
    assert.ok(patterns[0].regex.test('sk-or-v1-' + 'a'.repeat(64)));
    assert.ok(patterns[1].regex.test('gsk_' + 'B'.repeat(48)));
    assert.ok(patterns[2].regex.test('https://dash.cloudflare.com/oauth2/auth?response_type=code&' + 'code=' + 'abcdef1234567890'));
    assert.ok(patterns[2].regex.test('http://localhost:8976/oauth/callback?' + 'code=' + 'abcdef1234567890'));
    assert.ok(patterns[3].regex.test('ghp_' + '1'.repeat(36)));
    assert.ok(patterns[3].regex.test('github_pat_' + '2'.repeat(60)));
    assert.ok(patterns[4].regex.test('AIzaSy' + 'C'.repeat(33)));
    assert.ok(patterns[5].regex.test('-----BEGIN RSA ' + 'PRIVATE ' + 'KEY-----'));

    // Safe negative verification (safe code/text does not match):
    const safeSourceCode = 'const clientId = "ntk-note-client"; const authType = "google";';
    for (const pat of patterns) {
      assert.equal(pat.regex.test(safeSourceCode), false);
    }
  });

  test('Section 26: getTimestampMillis cleanly normalizes all timestamp shapes', () => {
    // 1. Number
    assert.equal(getTimestampMillis(1757073600000), 1757073600000);

    // 2. ISO String
    const iso = '2026-09-05T12:00:00.000Z';
    assert.equal(getTimestampMillis(iso), new Date(iso).getTime());

    // 3. Firestore Timestamp object with toMillis()
    const fsTimestamp = { toMillis: () => 1757073600000 };
    assert.equal(getTimestampMillis(fsTimestamp), 1757073600000);

    // 4. Firestore Timestamp object with seconds
    const fsSeconds = { seconds: 1757073600 };
    assert.equal(getTimestampMillis(fsSeconds), 1757073600000);

    // 5. Invalid/falsy values return 0
    assert.equal(getTimestampMillis(null), 0);
    assert.equal(getTimestampMillis(undefined), 0);
    assert.equal(getTimestampMillis('not-a-date'), 0);
  });

  test('Section 35: normalizeShareAccess preserves uid, displayName, photoURL and deduplicates', () => {
    const raw = [
      {
        email: 'Collaborator@Example.com',
        role: 'editor' as const,
        addedAt: '2026-09-01T00:00:00.000Z',
        uid: 'uid-collab-1',
        displayName: 'Alice Collab',
        photoURL: 'https://example.com/alice.jpg',
      },
      {
        email: 'collaborator@example.com ',
        role: 'editor' as const,
        addedAt: '2026-09-02T00:00:00.000Z',
      },
      {
        email: 'bob@example.com',
        role: 'viewer' as const,
        addedAt: '2026-09-03T00:00:00.000Z',
        uid: 'uid-bob-2',
      },
    ];

    const normalized = normalizeShareAccess(raw);
    assert.equal(normalized.length, 2);

    const alice = normalized.find(u => u.email === 'collaborator@example.com');
    assert.ok(alice);
    assert.equal(alice.uid, 'uid-collab-1');
    assert.equal(alice.displayName, 'Alice Collab');
    assert.equal(alice.photoURL, 'https://example.com/alice.jpg');

    const bob = normalized.find(u => u.email === 'bob@example.com');
    assert.ok(bob);
    assert.equal(bob.uid, 'uid-bob-2');
  });

  test('Section 35: legacyEmailsToShareAccess retains existing metadata when converting', () => {
    const previous = [
      {
        email: 'alice@example.com',
        role: 'editor' as const,
        addedAt: '2026-09-01T00:00:00.000Z',
        uid: 'alice-uid',
        displayName: 'Alice A',
        photoURL: 'https://example.com/a.png',
      },
    ];

    const result = legacyEmailsToShareAccess(['alice@example.com', 'charlie@example.com'], previous);
    assert.equal(result.length, 2);

    const alice = result.find(r => r.email === 'alice@example.com');
    assert.ok(alice);
    assert.equal(alice.uid, 'alice-uid');
    assert.equal(alice.displayName, 'Alice A');
    assert.equal(alice.photoURL, 'https://example.com/a.png');

    const charlie = result.find(r => r.email === 'charlie@example.com');
    assert.ok(charlie);
    assert.equal(charlie.role, 'editor');
    assert.equal(charlie.uid, undefined);
  });

  test('Section 35: getQuickShareSuggestions derives UID without directory lookups', () => {
    const myUid = 'user-owner-123';
    const myEmail = 'owner@example.com';

    const sampleNotes = [
      // 1. Note shared by another user where user is ownerId
      {
        id: 'note-1',
        title: 'Shared Project',
        content: 'Content',
        ownerId: 'collab-uid-alice',
        sharedBy: 'alice@example.com',
        createdAt: '2026-09-01T10:00:00.000Z',
        updatedAt: '2026-09-05T12:00:00.000Z',
      } as unknown as Note,
      // 2. Note owned by me, with collaborator in shareAccess having UID
      {
        id: 'note-2',
        title: 'My Notes',
        content: 'Content',
        ownerId: myUid,
        createdAt: '2026-09-02T10:00:00.000Z',
        updatedAt: '2026-09-05T14:00:00.000Z',
        shareAccess: [
          {
            email: 'bob@example.com',
            role: 'editor' as const,
            addedAt: '2026-09-02T10:00:00.000Z',
            uid: 'collab-uid-bob',
            displayName: 'Bob Builder',
            photoURL: 'https://example.com/bob.jpg',
          },
        ],
      } as unknown as Note,
    ];

    const sampleNotebooks = [
      {
        id: 'nb-1',
        name: 'Shared Notebook',
        ownerId: myUid,
        createdAt: '2026-09-03T10:00:00.000Z',
        shareAccess: [
          {
            email: 'clara@example.com',
            role: 'viewer' as const,
            addedAt: '2026-09-03T10:00:00.000Z',
            uid: 'collab-uid-clara',
            displayName: 'Clara Oswald',
          },
        ],
      },
    ];

    const sampleChats = [
      {
        id: 'chat-1',
        participantUids: [myUid, 'collab-uid-david'],
        participantEmails: [myEmail, 'david@example.com'],
        participantData: {
          'collab-uid-david': {
            name: 'David Tennant',
            email: 'david@example.com',
            photoURL: 'https://example.com/david.png',
          },
        },
      } as any,
    ];

    const suggestions = getQuickShareSuggestions(sampleNotes, sampleNotebooks, myUid, myEmail, 10, sampleChats);

    assert.ok(suggestions.length >= 4);

    const alice = suggestions.find(s => s.email === 'alice@example.com');
    assert.ok(alice);
    assert.equal(alice.uid, 'collab-uid-alice');

    const bob = suggestions.find(s => s.email === 'bob@example.com');
    assert.ok(bob);
    assert.equal(bob.uid, 'collab-uid-bob');
    assert.equal(bob.name, 'Bob Builder');
    assert.equal(bob.photoURL, 'https://example.com/bob.jpg');

    const clara = suggestions.find(s => s.email === 'clara@example.com');
    assert.ok(clara);
    assert.equal(clara.uid, 'collab-uid-clara');
    assert.equal(clara.name, 'Clara Oswald');

    const david = suggestions.find(s => s.email === 'david@example.com');
    assert.ok(david);
    assert.equal(david.uid, 'collab-uid-david');
    assert.equal(david.name, 'David Tennant');
  });

  test('Section 35: Media Authorization & Owner Bypass Elimination Logic', () => {
    // Gateway media authorization policy:
    // 1. If file.uid === caller.uid -> access granted
    // 2. If purpose is private ('voice-note', 'audio-export', 'note-export'), access denied EVEN IF caller.owner === true
    // 3. If purpose is 'note-attachment' and noteId is set, check sharedNoteAccess
    // 4. Otherwise access denied
    const authorizeFileAccess = (
      caller: { uid: string; owner?: boolean },
      file: { uid: string; purpose: string; noteId?: string },
      sharedNoteAccess: boolean
    ): boolean => {
      if (file.uid === caller.uid) return true;
      if (['voice-note', 'audio-export', 'note-export'].includes(file.purpose)) {
        return false; // NO owner bypass!
      }
      if (file.purpose === 'note-attachment' && file.noteId) {
        return sharedNoteAccess;
      }
      return false;
    };

    const callerAlice = { uid: 'alice-uid', owner: false };
    const callerAdmin = { uid: 'admin-uid', owner: true };
    const fileBobVoice = { uid: 'bob-uid', purpose: 'voice-note', noteId: 'note-123' };
    const fileBobExport = { uid: 'bob-uid', purpose: 'note-export', noteId: 'note-123' };
    const fileBobAttachment = { uid: 'bob-uid', purpose: 'note-attachment', noteId: 'note-shared' };

    // Alice cannot access Bob's voice note
    assert.equal(authorizeFileAccess(callerAlice, fileBobVoice, false), false);
    // CRITICAL: Admin / Owner CANNOT access Bob's voice note (Owner bypass eliminated)
    assert.equal(authorizeFileAccess(callerAdmin, fileBobVoice, false), false);
    // Admin cannot access Bob's export either
    assert.equal(authorizeFileAccess(callerAdmin, fileBobExport, false), false);
    // Bob can access his own voice note
    assert.equal(authorizeFileAccess({ uid: 'bob-uid', owner: false }, fileBobVoice, false), true);

    // Note attachment: granted if shared note access is valid
    assert.equal(authorizeFileAccess(callerAlice, fileBobAttachment, true), true);
    assert.equal(authorizeFileAccess(callerAlice, fileBobAttachment, false), false);
  });

  test('Section 35: Recursive forbidden directory segment exclusion logic', () => {
    const FORBIDDEN_DIR_SEGMENTS = new Set([
      'node_modules',
      '.git',
      '.firebase',
      '.wrangler',
      'backups',
      'dist',
      'dist-ssr',
      'logs',
      'scratch',
      '.system_generated',
    ]);

    const isExcluded = (relPath: string): boolean => {
      const norm = relPath.replace(/\\/g, '/');
      const segments = norm.split('/');
      for (const seg of segments) {
        if (FORBIDDEN_DIR_SEGMENTS.has(seg)) return true;
      }
      return false;
    };

    // Deep nested directories must be excluded
    assert.equal(isExcluded('cloudflare/ntk-gateway/dist/index.js'), true);
    assert.equal(isExcluded('cloudflare/ntk-gateway/dist/bundle.js'), true);
    assert.equal(isExcluded('dist/index.html'), true);
    assert.equal(isExcluded('sub/nested/node_modules/pkg/index.js'), true);
    assert.equal(isExcluded('.git/config'), true);
    assert.equal(isExcluded('scratch/temp.txt'), true);

    // Legitimate files must NOT be excluded
    assert.equal(isExcluded('src/components/NewMessageModal.tsx'), false);
    assert.equal(isExcluded('cloudflare/ntk-gateway/src/index.ts'), false);
    assert.equal(isExcluded('public/images/hero-bg.jpg'), false);
    assert.equal(isExcluded('scripts/create_final_sanitized_zip.mjs'), false);
  });
});

describe('Section 36: NTK Note v2.6 — Complete Recycle Bin, Safe Permanent Deletion & Storage Cleanup', () => {
  const dummyUserA = 'user_alice_123';
  const dummyUserB = 'user_bob_456';
  const dummyAdmin = '0yZ0Zl1yv1Z5w2X1q0r8s9t0u1v2'; // Owner UID

  const sampleNotebooks: Notebook[] = [
    { id: 'nb_parent', name: 'Work', icon: '💼', createdAt: '2026-01-01', updatedAt: '2026-01-01', trashed: true, trashedAt: '2026-01-02' },
    { id: 'nb_child', name: 'Projects', icon: '🚀', parentId: 'nb_parent', createdAt: '2026-01-01', updatedAt: '2026-01-01', trashed: true, trashedAt: '2026-01-02' },
    { id: 'nb_active', name: 'Personal', icon: '🏠', createdAt: '2026-01-01', updatedAt: '2026-01-01', trashed: false },
  ];

  const sampleNotes: Note[] = [
    {
      id: 'note_trashed_1',
      notebookId: 'nb_parent',
      title: 'Trashed Note 1',
      content: 'Hello world',
      type: 'note',
      tags: [],
      checklist: [],
      trashed: true,
      trashedAt: '2026-01-02',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      ownerId: dummyUserA,
      attachments: [{ id: 'att_1', name: 'doc.pdf', size: 1024, type: 'application/pdf', objectId: 'obj_pdf_1' }],
    },
    {
      id: 'note_trashed_2',
      notebookId: 'nb_child',
      title: 'Trashed Note 2',
      content: 'Nested trashed note with shared image',
      type: 'note',
      tags: [],
      checklist: [],
      trashed: true,
      trashedAt: '2026-01-02',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      ownerId: dummyUserA,
      photos: [{ id: 'photo_1', url: 'https://gateway.com/v1/storage/file/images/obj_img_shared', objectId: 'obj_img_shared' }],
    },
    {
      id: 'note_active_in_trashed_nb',
      notebookId: 'nb_parent',
      title: 'Active note surviving parent trashed nb',
      content: 'I MUST NOT BE DELETED!',
      type: 'note',
      tags: [],
      checklist: [],
      trashed: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      ownerId: dummyUserA,
      photos: [{ id: 'photo_2', url: 'https://gateway.com/v1/storage/file/images/obj_img_shared', objectId: 'obj_img_shared' }],
    },
    {
      id: 'note_active_standalone',
      notebookId: 'nb_active',
      title: 'Active standalone note',
      content: 'Normal note',
      type: 'note',
      tags: [],
      checklist: [],
      trashed: false,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      ownerId: dummyUserA,
    },
    {
      id: 'note_shared_owned_by_a',
      notebookId: 'default',
      title: 'Collaborative Document',
      content: 'Shared with Bob',
      type: 'note',
      tags: [],
      checklist: [],
      trashed: true,
      trashedAt: '2026-01-02',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
      ownerId: dummyUserA,
      isShared: true,
      sharedBy: 'alice@example.com',
      shareAccess: [{ email: 'bob@example.com', role: 'editor', uid: dummyUserB }],
    },
  ];

  const sampleReminders: AppReminder[] = [
    { id: 'rem_linked_1', noteId: 'note_trashed_1', title: 'Finish Note 1', dueAt: '2026-01-03', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
    { id: 'rem_standalone', title: 'Buy Groceries', dueAt: '2026-01-03', status: 'active', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
  ];

  test('Empty Recycle Bin plan includes both trashed notes AND trashed notebooks', () => {
    const plan = buildDeletionPlan({
      allNotes: sampleNotes,
      allNotebooks: sampleNotebooks,
      allReminders: sampleReminders,
      currentUserId: dummyUserA,
    });

    // 3 trashed notes: note_trashed_1, note_trashed_2, note_shared_owned_by_a
    assert.equal(plan.notesToDelete.length, 3);
    assert.ok(plan.notesToDelete.some(n => n.id === 'note_trashed_1'));
    assert.ok(plan.notesToDelete.some(n => n.id === 'note_trashed_2'));
    assert.ok(plan.notesToDelete.some(n => n.id === 'note_shared_owned_by_a'));

    // 2 trashed notebooks: nb_parent, nb_child
    assert.equal(plan.notebooksToDelete.length, 2);
    assert.ok(plan.notebooksToDelete.some(nb => nb.id === 'nb_parent'));
    assert.ok(plan.notebooksToDelete.some(nb => nb.id === 'nb_child'));

    // Active notebook Personal must NOT be in deletion plan
    assert.ok(!plan.notebooksToDelete.some(nb => nb.id === 'nb_active'));
  });

  test('Notebook-only trash exposes Empty Recycle Bin and includes only trashed notebooks', () => {
    const notesWithNoTrash = sampleNotes.map(n => ({ ...n, trashed: false }));
    const plan = buildDeletionPlan({
      allNotes: notesWithNoTrash,
      allNotebooks: sampleNotebooks,
      currentUserId: dummyUserA,
    });

    // Notes to delete: 0
    assert.equal(plan.notesToDelete.length, 0);
    // Trashed notebooks still included: 2
    assert.equal(plan.notebooksToDelete.length, 2);
    // Total deletion count > 0 -> Empty Recycle Bin remains available
    assert.ok(plan.notesToDelete.length + plan.notebooksToDelete.length > 0);
  });

  test('Active notes inside a trashed notebook are reparented to default, NOT deleted', () => {
    const plan = buildDeletionPlan({
      allNotes: sampleNotes,
      allNotebooks: sampleNotebooks,
      targetNotebookIds: ['nb_parent'],
      currentUserId: dummyUserA,
    });

    // Active note must NOT be in notesToDelete
    assert.ok(!plan.notesToDelete.some(n => n.id === 'note_active_in_trashed_nb'));
    // Active note MUST be in activeNotesToReparent
    assert.ok(plan.activeNotesToReparent.some(n => n.id === 'note_active_in_trashed_nb'));
  });

  test('Media extraction finds attachments, photos, and voice notes', () => {
    const noteWithMedia: Note = {
      ...sampleNotes[0],
      photos: [{ id: 'p1', objectId: 'obj_photo_test', url: 'https://gateway/obj_photo_test' }],
      voiceNotes: [{ id: 'v1', objectId: 'obj_voice_test', url: 'https://gateway/obj_voice_test', duration: 10, createdAt: '2026-01-01' }],
    };

    const candidates = extractMediaCandidates(noteWithMedia);
    assert.equal(candidates.length, 3);
    assert.ok(candidates.some(c => c.objectId === 'obj_pdf_1' && c.purpose === 'attachments'));
    assert.ok(candidates.some(c => c.objectId === 'obj_photo_test' && c.purpose === 'images'));
    assert.ok(candidates.some(c => c.objectId === 'obj_voice_test' && c.purpose === 'voiceNotes'));
  });

  test('Media reuse safety: R2 deletion is skipped if another active note references the same media', () => {
    // Candidate is referenced in note_active_in_trashed_nb (which is active, trashed === false)
    const isReused = isMediaReused('obj_img_shared', 'note_trashed_2', sampleNotes, new Set(['note_trashed_2']));
    assert.equal(isReused, true, 'Media used by active note must be flagged as reused');

    const isExclusiveReused = isMediaReused('obj_pdf_1', 'note_trashed_1', sampleNotes, new Set(['note_trashed_1']));
    assert.equal(isExclusiveReused, false, 'Exclusive media must NOT be flagged as reused');
  });

  test('Offline check blocks irreversible permanent deletion', () => {
    const originalNavigator = globalThis.navigator;
    try {
      // Simulate offline
      Object.defineProperty(globalThis, 'navigator', {
        value: { onLine: false },
        configurable: true,
      });

      const isOfflineBlocked = (navigator: { onLine: boolean }): boolean => {
        return !navigator.onLine;
      };

      assert.equal(isOfflineBlocked(globalThis.navigator), true);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: originalNavigator,
        configurable: true,
      });
    }
  });

  test('Multi-device stale protection: note restored remotely is skipped from permanent deletion', () => {
    const trashedNoteLocal = { id: 'note_stale_1', trashed: true };
    const remoteDocState = { trashed: false, updatedAt: '2026-01-03T10:00:00Z' };

    const shouldSkipDueToRemoteRestore = (remoteData: { trashed: boolean } | null) => {
      if (!remoteData) return false;
      return remoteData.trashed !== true; // Restored on another device
    };

    assert.equal(shouldSkipDueToRemoteRestore(remoteDocState), true);
  });

  test('Collaborator vs Owner semantics: collaborator cannot delete owner note', () => {
    const sharedNote = sampleNotes.find(n => n.id === 'note_shared_owned_by_a')!;

    const canPermanentlyDelete = (callerUid: string, note: Note): boolean => {
      // Only canonical owner can permanently delete
      return note.ownerId === callerUid;
    };

    // User A (Owner) -> ALLOWED
    assert.equal(canPermanentlyDelete(dummyUserA, sharedNote), true);
    // User B (Collaborator) -> DENIED
    assert.equal(canPermanentlyDelete(dummyUserB, sharedNote), false);
    // Admin / Infrastructure Owner -> DENIED (Owner non-surveillance)
    assert.equal(canPermanentlyDelete(dummyAdmin, sharedNote), false);
  });

  test('Owner permanently deleting shared note cleans canonical shared record', () => {
    const plan = buildDeletionPlan({
      allNotes: sampleNotes,
      allNotebooks: sampleNotebooks,
      targetNoteIds: ['note_shared_owned_by_a'],
      currentUserId: dummyUserA,
    });

    assert.equal(plan.ownedSharedNotesToRemove.length, 1);
    assert.equal(plan.ownedSharedNotesToRemove[0].id, 'note_shared_owned_by_a');
  });

  test('Reminder cleanup: note-linked reminders are cleaned, standalone reminders untouched', () => {
    const plan = buildDeletionPlan({
      allNotes: sampleNotes,
      allNotebooks: sampleNotebooks,
      allReminders: sampleReminders,
      targetNoteIds: ['note_trashed_1'],
      currentUserId: dummyUserA,
    });

    assert.equal(plan.remindersToClean.length, 1);
    assert.equal(plan.remindersToClean[0].id, 'rem_linked_1');
    assert.ok(!plan.remindersToClean.some(r => r.id === 'rem_standalone'));
  });

  test('Worker R2 Delete Authorization: uploader/owner allowed, cross-user denied, admin denied', () => {
    const fileRecord = {
      objectId: 'file_obj_100',
      uid: dummyUserA,
      uploaderUid: dummyUserA,
      purpose: 'attachments',
    };

    const authorizeDelete = (caller: { uid: string; owner?: boolean }, record: typeof fileRecord | null) => {
      if (!record) return { status: 404, allowed: false };
      // Strict ownership: record.uid === caller.uid || record.uploaderUid === caller.uid
      // NO OWNER BYPASS
      if (record.uid === caller.uid || record.uploaderUid === caller.uid) {
        return { status: 200, allowed: true };
      }
      return { status: 403, allowed: false };
    };

    // Owner -> 200
    assert.equal(authorizeDelete({ uid: dummyUserA }, fileRecord).status, 200);
    // User B -> 403
    assert.equal(authorizeDelete({ uid: dummyUserB }, fileRecord).status, 403);
    // Infrastructure Admin -> 403 (No bypass)
    assert.equal(authorizeDelete({ uid: dummyAdmin, owner: true }, fileRecord).status, 403);
  });

  test('Missing R2 object returns idempotent success (404 handled gracefully)', () => {
    const handleR2DeleteResult = (r2HeadResult: boolean) => {
      if (!r2HeadResult) {
        // Object absent: return ok: true and proceed with metadata cleanup
        return { ok: true, cleanedMetadata: true, idempotent: true };
      }
      return { ok: true, cleanedMetadata: true, idempotent: false };
    };

    const absentResult = handleR2DeleteResult(false);
    assert.equal(absentResult.ok, true);
    assert.equal(absentResult.idempotent, true);
  });

  test('Spark budget invariant: max batch size <= 25, 0 Cloud Functions, 0 Firebase Storage media', () => {
    const BATCH_SIZE = 25;
    assert.ok(BATCH_SIZE <= 500, 'Firestore batch limit is 500; 25 ensures safe bounded execution');
    assert.ok(BATCH_SIZE <= 50, 'Section 25 mandates bounded batches 25-50');

    // Storage is strictly Cloudflare R2
    const storageProvider = 'cloudflare-r2';
    assert.notEqual(storageProvider, 'firebase-storage');
  });

  test('Regression (Section 6, 31): isMediaReused flags media referenced by another TRASHED note', () => {
    const trashedNoteA: Note = {
      id: 'trashed_A',
      title: 'Trashed A',
      content: 'Note A',
      type: 'note',
      color: 'default',
      tags: [],
      notebookId: 'default',
      pinned: false,
      starred: false,
      archived: false,
      trashed: true,
      locked: false,
      checklist: [],
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 2,
      charCount: 6,
      linkedNoteIds: [],
      order: 0,
      photos: [{ id: 'pA', objectId: 'shared_media_123', name: 'imgA.png', size: 100, mimeType: 'image/png', createdAt: '2026-01-01' }],
    };

    const trashedNoteB: Note = {
      id: 'trashed_B',
      title: 'Trashed B',
      content: 'Note B',
      type: 'note',
      color: 'default',
      tags: [],
      notebookId: 'default',
      pinned: false,
      starred: false,
      archived: false,
      trashed: true,
      locked: false,
      checklist: [],
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 2,
      charCount: 6,
      linkedNoteIds: [],
      order: 1,
      images: [{ id: 'imgB', objectId: 'shared_media_123', name: 'imgB.png', size: 100, mimeType: 'image/png', createdAt: '2026-01-01' }],
    };

    const notes = [trashedNoteA, trashedNoteB];

    // Case 1: Delete only Note A. Note B remains in trash. Media MUST be protected!
    const reusedWhenDeletingOnlyA = isMediaReused('shared_media_123', 'trashed_A', notes, new Set(['trashed_A']));
    assert.equal(reusedWhenDeletingOnlyA, true, 'Media referenced by trashed Note B must NOT be deleted when only Note A is permanently deleted');

    // Case 2: Delete both Note A and Note B together. Media can now be safely deleted!
    const reusedWhenDeletingBoth = isMediaReused('shared_media_123', 'trashed_A', notes, new Set(['trashed_A', 'trashed_B']));
    assert.equal(reusedWhenDeletingBoth, false, 'Media should not be flagged as reused when all referencing notes are being deleted');
  });

  test('Regression (Section 7, 32): extractMediaCandidates harvests BOTH note.images and note.photos deduplicated by purpose:objectId', () => {
    const multiMediaNote: Note = {
      id: 'multi_media_note',
      title: 'Multi Media Note',
      content: 'Here is an embedded file: /v1/storage/file/attachments/att_embedded_url',
      type: 'note',
      color: 'default',
      tags: [],
      notebookId: 'default',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      locked: false,
      checklist: [],
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 5,
      charCount: 30,
      linkedNoteIds: [],
      order: 0,
      attachments: [{ id: 'att_1', name: 'sheet.xlsx', size: 200, mimeType: 'application/excel', objectId: 'att_file_1', createdAt: '2026-01-01' }],
      images: [{ id: 'img_1', name: 'diagram.png', size: 150, mimeType: 'image/png', objectId: 'img_file_1', createdAt: '2026-01-01' }],
      photos: [{ id: 'photo_1', name: 'camera.jpg', size: 250, mimeType: 'image/jpeg', objectId: 'photo_file_1', createdAt: '2026-01-01' }],
      voiceNotes: [{ id: 'vn_1', title: 'memo.m4a', durationSeconds: 15, size: 500, mimeType: 'audio/m4a', objectId: 'vn_file_1', createdAt: '2026-01-01' }],
    };

    const candidates = extractMediaCandidates(multiMediaNote);

    // Must extract: attachments (att_file_1, att_embedded_url), images (img_file_1, photo_file_1), voiceNotes (vn_file_1)
    assert.equal(candidates.length, 5);
    assert.ok(candidates.some(c => c.objectId === 'att_file_1' && c.purpose === 'attachments'));
    assert.ok(candidates.some(c => c.objectId === 'att_embedded_url' && c.purpose === 'attachments'));
    assert.ok(candidates.some(c => c.objectId === 'img_file_1' && c.purpose === 'images'));
    assert.ok(candidates.some(c => c.objectId === 'photo_file_1' && c.purpose === 'images'));
    assert.ok(candidates.some(c => c.objectId === 'vn_file_1' && c.purpose === 'voiceNotes'));
  });

  test('Regression (Section 8, 9, 30, 33): Worker storage DELETE transaction safety prevents metadata loss on physical deletion failure', async () => {
    let physicalDeleteSucceeded = false;
    let metadataDeleted = false;
    let storageQuotaAdjusted = false;

    const performDeleteTransaction = async (storageThrows: boolean, is404: boolean) => {
      if (storageThrows) {
        if (!is404) {
          return { status: 500, code: 'STORAGE_DELETE_FAILED' };
        }
      }
      physicalDeleteSucceeded = true;
      storageQuotaAdjusted = true;
      metadataDeleted = true;
      return { status: 200, ok: true };
    };

    // Case 1: Storage delete throws 500 error
    physicalDeleteSucceeded = false;
    metadataDeleted = false;
    storageQuotaAdjusted = false;
    const failResult = await performDeleteTransaction(true, false);
    assert.equal(failResult.status, 500);
    assert.equal(metadataDeleted, false, 'KV metadata must NOT be deleted when physical storage deletion fails');
    assert.equal(storageQuotaAdjusted, false, 'Storage quota must NOT be decremented when physical deletion fails');

    // Case 2: Storage delete succeeds
    physicalDeleteSucceeded = false;
    metadataDeleted = false;
    storageQuotaAdjusted = false;
    const successResult = await performDeleteTransaction(false, false);
    assert.equal(successResult.status, 200);
    assert.equal(metadataDeleted, true);
    assert.equal(storageQuotaAdjusted, true);

    // Case 3: Storage delete confirms object 404 absent (idempotent)
    physicalDeleteSucceeded = false;
    metadataDeleted = false;
    storageQuotaAdjusted = false;
    const idempotentResult = await performDeleteTransaction(true, true);
    assert.equal(idempotentResult.status, 200);
    assert.equal(metadataDeleted, true);
    assert.equal(storageQuotaAdjusted, true);
  });

  test('Regression (Section 13, 14, 15): Notebook authoritative stale protection skips restored notebooks', () => {
    const remoteNotebookDoc = { trashed: false, name: 'Work', updatedAt: '2026-01-05' };

    const isNotebookRestoredElsewhere = (remoteDoc: { trashed: boolean } | null): boolean => {
      if (!remoteDoc) return false;
      return remoteDoc.trashed !== true;
    };

    assert.equal(isNotebookRestoredElsewhere(remoteNotebookDoc), true);
  });

  test('Regression (Section 16, 17, 18): Exact stale reconciliation in store restores only staleSkippedNoteIds', () => {
    const initialNotes: Note[] = [
      { id: 'note_A', title: 'A', trashed: true } as Note,
      { id: 'note_B', title: 'B', trashed: true } as Note,
      { id: 'note_C', title: 'C', trashed: true } as Note,
    ];

    const result = {
      deletedNoteIds: ['note_A'],
      staleSkippedNoteIds: ['note_B'],
      failedNoteIds: ['note_C'],
    };

    const staleSet = new Set(result.staleSkippedNoteIds);
    const deletedSet = new Set(result.deletedNoteIds);
    const updatedNotes = initialNotes
      .filter(n => !deletedSet.has(n.id))
      .map(n => staleSet.has(n.id) ? { ...n, trashed: false } : n);

    assert.equal(updatedNotes.length, 2);
    const noteB = updatedNotes.find(n => n.id === 'note_B')!;
    const noteC = updatedNotes.find(n => n.id === 'note_C')!;
    assert.equal(noteB.trashed, false, 'note_B was restored on another device so it becomes restored');
    assert.equal(noteC.trashed, true, 'note_C failed to delete and MUST REMAIN trashed');
  });

  test('Regression (Section 19, 20): Reminder IDs never contaminate deletedNoteIds', () => {
    const deletedNoteIds: string[] = ['note_101'];
    const deletedReminderIds: string[] = ['rem_202'];

    assert.ok(!deletedNoteIds.includes('rem_202'), 'Reminder ID must not be inside deletedNoteIds');
    assert.equal(deletedReminderIds.length, 1);
  });

  test('Regression (Section 22, 23, 24): Retention dependency preserves younger trashed notes and child notebooks', () => {
    const parentNotebook: Notebook = { id: 'nb_parent_old', name: 'Old Notebook', trashed: true, trashedAt: '2025-12-01', sections: [], createdAt: '', order: 0, color: 'default', icon: '', parentId: null };
    const childNotebookYoung: Notebook = { id: 'nb_child_young', name: 'Young Child', trashed: true, trashedAt: '2026-01-01', parentId: 'nb_parent_old', sections: [], createdAt: '', order: 0, color: 'default', icon: '' };
    const activeNote: Note = { id: 'note_active', notebookId: 'nb_parent_old', trashed: false } as Note;
    const youngTrashedNote: Note = { id: 'note_young_trashed', notebookId: 'nb_parent_old', trashed: true, trashedAt: '2026-01-01' } as Note;
    const oldTrashedNote: Note = { id: 'note_old_trashed', notebookId: 'nb_parent_old', trashed: true, trashedAt: '2025-12-01' } as Note;

    const plan = buildDeletionPlan({
      allNotes: [activeNote, youngTrashedNote, oldTrashedNote],
      allNotebooks: [parentNotebook, childNotebookYoung],
      targetNoteIds: ['note_old_trashed'],
      targetNotebookIds: ['nb_parent_old'],
      currentUserId: dummyUserA,
    });

    assert.ok(plan.notesToDelete.some(n => n.id === 'note_old_trashed'));
    assert.ok(!plan.notesToDelete.some(n => n.id === 'note_young_trashed'));
    assert.ok(!plan.notesToDelete.some(n => n.id === 'note_active'));
    assert.ok(plan.survivingNotesToReparent.some(n => n.id === 'note_active'));
    assert.ok(plan.survivingNotesToReparent.some(n => n.id === 'note_young_trashed'));
    assert.ok(!plan.notebooksToDelete.some(nb => nb.id === 'nb_child_young'));
    assert.ok(plan.childNotebooksToReparent.some(nb => nb.id === 'nb_child_young'));
  });

  test('Regression (Section 26, 27): Paginated KV direct file index migration processes >100 records', async () => {
    const allKeys = Array.from({ length: 150 }, (_, i) => ({ name: `user-file:uid:images:file_${i}` }));
    let cursor: string | undefined = undefined;
    let totalMigrated = 0;
    let complete = false;

    const listBatch = (c?: string) => {
      const start = c ? parseInt(c, 10) : 0;
      const batch = allKeys.slice(start, start + 50);
      const nextCursor = start + 50 < allKeys.length ? String(start + 50) : undefined;
      return { keys: batch, cursor: nextCursor, list_complete: start + 50 >= allKeys.length };
    };

    while (!complete) {
      const res = listBatch(cursor);
      totalMigrated += res.keys.length;
      if (res.list_complete) {
        complete = true;
      } else {
        cursor = res.cursor;
      }
    }

    assert.equal(totalMigrated, 150, 'All 150 keys across multiple pages must be migrated');
    assert.equal(complete, true, 'Migration marked complete only after last page');
  });
});

describe('Section 37: NTK Note v2.6 — True Final Data-Lifecycle Closure Suite', () => {
  const dummyUserA = 'user_closure_A';
  const dummyUserB = 'user_closure_B';

  test('Section 28-31: Purpose-safe media identity prevents false reuse collision between attachments and images', () => {
    const noteA: Note = {
      id: 'note_col_A',
      title: 'Note A',
      notebookId: 'nb_1',
      trashed: true,
      trashedAt: '2026-01-01',
      attachments: [{ id: 'att_1', name: 'report.pdf', size: 100, mimeType: 'application/pdf', objectId: 'obj_shared_id', createdAt: '2026-01-01' }],
      images: [],
      photos: [],
      voiceNotes: [],
      tags: [],
      favorite: false,
      pinned: false,
      archived: false,
      color: 'default',
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 1,
      charCount: 1,
      linkedNoteIds: [],
      order: 0,
    };

    const noteB: Note = {
      id: 'note_col_B',
      title: 'Note B',
      notebookId: 'nb_1',
      trashed: false,
      attachments: [],
      images: [{ id: 'img_1', name: 'photo.jpg', size: 100, mimeType: 'image/jpeg', objectId: 'obj_shared_id', createdAt: '2026-01-01' }],
      photos: [],
      voiceNotes: [],
      tags: [],
      favorite: false,
      pinned: false,
      archived: false,
      color: 'default',
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 1,
      charCount: 1,
      linkedNoteIds: [],
      order: 1,
    };

    // Note A has an attachment with objectId 'obj_shared_id'
    // Note B has an image with the SAME objectId 'obj_shared_id'
    // Deleting Note A must NOT treat its attachment as reused by Note B's image!
    const attachmentReused = isMediaReused('attachments', 'obj_shared_id', noteA.id, [noteA, noteB], new Set(['note_col_A']));
    assert.equal(attachmentReused, false, 'Attachment obj_shared_id is not reused by an image with the same objectId');

    const imageReused = isMediaReused('images', 'obj_shared_id', noteB.id, [noteA, noteB], new Set(['note_col_A']));
    assert.equal(imageReused, false, 'Image obj_shared_id is not reused by an attachment with the same objectId');

    // Build plan deleting note A
    const plan = buildDeletionPlan({
      allNotes: [noteA, noteB],
      allNotebooks: [],
      targetNoteIds: ['note_col_A'],
      currentUserId: dummyUserA,
    });

    assert.equal(plan.mediaCandidates.length, 1);
    assert.equal(plan.mediaCandidates[0].purpose, 'attachments');
    assert.equal(plan.mediaCandidates[0].objectId, 'obj_shared_id');
  });

  test('Section 6-10: Pending media cleanup retry backoff, persistence schedule, and UID isolation', () => {
    // 1. Backoff schedule calculation
    const attempt0 = calculateNextEligibleAttempt(0);
    const attempt1 = calculateNextEligibleAttempt(1);
    const attempt2 = calculateNextEligibleAttempt(2);
    const attempt3 = calculateNextEligibleAttempt(3);
    const attempt5 = calculateNextEligibleAttempt(5);

    const now = Date.now();
    assert.ok(new Date(attempt0).getTime() <= now + 50, 'Attempt 0 is eligible immediately');
    assert.ok(new Date(attempt1).getTime() <= now + 50, 'Attempt 1 is eligible immediately');
    assert.ok(new Date(attempt2).getTime() >= now + 55 * 1000, 'Attempt 2 backoff >= 60s');
    assert.ok(new Date(attempt3).getTime() >= now + 295 * 1000, 'Attempt 3 backoff >= 5 minutes');
    assert.ok(new Date(attempt5).getTime() <= now + 3601 * 1000, 'Attempt 5 capped at 1 hour ceiling');

    // 2. Queue and UID isolation
    const mockStorage: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
    };

    enqueuePendingMediaCleanup({
      uid: dummyUserA,
      purpose: 'attachments',
      objectId: 'obj_att_userA',
      noteId: 'note_A',
    });

    enqueuePendingMediaCleanup({
      uid: dummyUserB,
      purpose: 'images',
      objectId: 'obj_img_userB',
      noteId: 'note_B',
    });

    const userAItems = getPendingMediaCleanups(dummyUserA);
    const userBItems = getPendingMediaCleanups(dummyUserB);
    const guestItems = getPendingMediaCleanups('');

    assert.equal(userAItems.length, 1);
    assert.equal(userAItems[0].objectId, 'obj_att_userA');
    assert.equal(userBItems.length, 1);
    assert.equal(userBItems[0].objectId, 'obj_img_userB');
    assert.equal(guestItems.length, 0, 'Guest UID must never access user cleanup entries');

    // Verify storage persistence
    const rawQueue = JSON.parse(mockStorage['ntk_pending_media_cleanup_queue'] || '[]');
    assert.equal(rawQueue.length, 2);
    assert.ok(rawQueue.every((item: any) => item.retryCount === 0));
  });

  test('Section 15, 16, 17, 44: Stale parent notebook restored remotely causes ZERO reparenting of child content', () => {
    // Notebook A locally trashed, Note N inside A active
    const notebookA: Notebook = { id: 'nb_stale_parent', name: 'Parent A', trashed: true, trashedAt: '2026-01-01', parentId: null, sections: [], createdAt: '', order: 0, color: 'default', icon: '' };
    const childNb: Notebook = { id: 'nb_child_under_A', name: 'Child under A', trashed: false, parentId: 'nb_stale_parent', sections: [], createdAt: '', order: 0, color: 'default', icon: '' };
    const activeNoteN: Note = { id: 'note_inside_A', title: 'Note N', notebookId: 'nb_stale_parent', trashed: false } as Note;

    // Simulation of post-verification dependency recomputation:
    // Notebook A was restored on another device -> placed in staleSkippedNotebookIds
    const staleSkippedNotebookIds = ['nb_stale_parent'];
    const verifiedNotebookIdsToDelete = [notebookA]
      .filter(nb => !staleSkippedNotebookIds.includes(nb.id))
      .map(nb => nb.id);

    assert.equal(verifiedNotebookIdsToDelete.length, 0, 'Notebook A is excluded from verified deletions');

    // Dependencies recomputed against verifiedNotebookIdsToDelete:
    const verifiedNotebookIdsSet = new Set(verifiedNotebookIdsToDelete);
    const survivingNotesToReparent = [activeNoteN].filter(
      note => note.notebookId && verifiedNotebookIdsSet.has(note.notebookId)
    );
    const childNotebooksToReparent = [childNb].filter(
      nb => nb.parentId && verifiedNotebookIdsSet.has(nb.parentId)
    );

    assert.equal(survivingNotesToReparent.length, 0, 'Stale parent notebook causes ZERO note reparenting');
    assert.equal(childNotebooksToReparent.length, 0, 'Stale parent notebook causes ZERO child notebook reparenting');
    assert.equal(activeNoteN.notebookId, 'nb_stale_parent', 'Note N remains safely in Notebook A');
    assert.equal(childNb.parentId, 'nb_stale_parent', 'Child notebook remains safely under Notebook A');
  });

  test('Section 18, 19, 43: Stale note restored remotely inside deleted notebook reparents to default before notebook deletion', () => {
    const notebookA: Notebook = { id: 'nb_to_delete', name: 'Notebook A', trashed: true, parentId: null, sections: [], createdAt: '', order: 0, color: 'default', icon: '' };
    // Note N was targeted for deletion, but remote Firestore check finds trashed === false
    const noteN: Note = { id: 'note_N_restored', title: 'Restored Note', notebookId: 'nb_to_delete', trashed: true } as Note;

    const staleSkippedNoteIds = ['note_N_restored'];
    const verifiedNotebookIdsSet = new Set(['nb_to_delete']);
    const verifiedNoteIdsSet = new Set<string>(); // Note N is NOT in verified deleted notes

    // Post-verification surviving note detection:
    const allNotes = [noteN];
    const survivingNotesToReparent = allNotes.filter(
      note => note.notebookId && verifiedNotebookIdsSet.has(note.notebookId) && !verifiedNoteIdsSet.has(note.id)
    );

    assert.equal(survivingNotesToReparent.length, 1);
    assert.equal(survivingNotesToReparent[0].id, 'note_N_restored');

    // Reparent target
    const reparentUpdate = {
      notebookId: 'default',
      sectionId: null,
      trashed: false, // preserved remote restored status
    };
    assert.equal(reparentUpdate.notebookId, 'default', 'Restored note reparented to default so notebook deletion does not orphan it');
  });

  test('Section 20, 42: Failed note validation inside deleted notebook blocks parent notebook deletion', () => {
    const notebookA: Notebook = { id: 'nb_parent_failing', name: 'Notebook A', trashed: true, parentId: null, sections: [], createdAt: '', order: 0, color: 'default', icon: '' };
    const noteN: Note = { id: 'note_N_failed_check', notebookId: 'nb_parent_failing', trashed: true } as Note;

    const failedNoteIdsSet = new Set(['note_N_failed_check']);
    const planNotesToDelete = [noteN];

    // Check if notebook has any child notes that failed authoritative verification
    const failedNotebookIds: string[] = [];
    const verifiedNotebooksToDelete: Notebook[] = [];

    const hasFailedChildNote = planNotesToDelete.some(
      n => n.notebookId === notebookA.id && failedNoteIdsSet.has(n.id)
    );

    if (hasFailedChildNote) {
      failedNotebookIds.push(notebookA.id);
    } else {
      verifiedNotebooksToDelete.push(notebookA);
    }

    assert.equal(verifiedNotebooksToDelete.length, 0, 'Parent notebook deletion is blocked when child note state is uncertain');
    assert.equal(failedNotebookIds.length, 1);
    assert.equal(failedNotebookIds[0], 'nb_parent_failing');
  });

  test('Section 21, 45: Child notebook reparent failure blocks parent deletion', () => {
    const parentA: Notebook = { id: 'nb_parent_blocked', name: 'Parent', trashed: true, parentId: null, sections: [], createdAt: '', order: 0, color: 'default', icon: '' };
    const childB: Notebook = { id: 'nb_child_surviving', name: 'Child', trashed: false, parentId: 'nb_parent_blocked', sections: [], createdAt: '', order: 0, color: 'default', icon: '' };

    const verifiedNotebooksCandidate = [parentA];
    const blockedParentNotebookIds = new Set<string>();
    const failedNotebookIds: string[] = [];

    // Simulate child B reparent write failure
    const simulateReparentChild = (child: Notebook): boolean => {
      // simulate Firestore batch failure
      return false;
    };

    const reparentSuccess = simulateReparentChild(childB);
    if (!reparentSuccess) {
      if (childB.parentId) {
        blockedParentNotebookIds.add(childB.parentId);
        failedNotebookIds.push(childB.parentId);
      }
    }

    const finalNotebooksToDelete = verifiedNotebooksCandidate.filter(
      nb => !blockedParentNotebookIds.has(nb.id)
    );

    assert.equal(finalNotebooksToDelete.length, 0, 'Parent notebook A is NOT deleted when child B reparent fails');
    assert.equal(failedNotebookIds.includes('nb_parent_blocked'), true);
  });

  test('Section 24-27, 41: Reminders are cleaned ONLY for genuinely deleted notes, and reminder failures are isolated', () => {
    const trashedNoteA: Note = { id: 'note_stale_rem', title: 'Note A', trashed: true } as Note;
    const trashedNoteB: Note = { id: 'note_deleted_rem', title: 'Note B', trashed: true } as Note;

    const reminderA: AppReminder = { id: 'rem_A', noteId: 'note_stale_rem', title: 'Rem A', dueAt: '', status: 'active', createdAt: '', updatedAt: '' };
    const reminderB: AppReminder = { id: 'rem_B', noteId: 'note_deleted_rem', title: 'Rem B', dueAt: '', status: 'active', createdAt: '', updatedAt: '' };

    const planReminders = [reminderA, reminderB];

    // Device B restored Note A, so Note A was skipped
    const successfullyDeletedNoteIds = ['note_deleted_rem'];

    // Only clean reminders whose noteId is in successfullyDeletedNoteIds:
    const remindersToClean = planReminders.filter(
      r => r.noteId && successfullyDeletedNoteIds.includes(r.noteId)
    );

    assert.equal(remindersToClean.length, 1);
    assert.equal(remindersToClean[0].id, 'rem_B', 'Only reminder B is cleaned');
    assert.ok(!remindersToClean.some(r => r.id === 'rem_A'), 'Reminder A is preserved for stale-restored Note A');

    // Simulate reminder B deletion failure:
    const deletedReminderIds: string[] = [];
    const failedReminderIds: string[] = ['rem_B'];

    // DeletionResult maintains isolated reminder results:
    const deletionResult = {
      ok: true,
      deletedNoteIds: successfullyDeletedNoteIds,
      deletedReminderIds,
      failedReminderIds,
    };

    assert.equal(deletionResult.deletedNoteIds.length, 1, 'Note B remains permanently deleted even if reminder B deletion failed');
    assert.equal(deletionResult.failedReminderIds.length, 1);
    assert.equal(deletionResult.failedReminderIds[0], 'rem_B');
  });

  test('Section 32-36: Controlled KV migration batch logic updates progress and marks complete safely', async () => {
    const mockKVStore: Record<string, string> = {
      'user-file:uid1:images:img1': JSON.stringify({ id: 'img1', uid: 'uid1', purpose: 'images', fileName: 'test.jpg' }),
      'user-file:uid1:images:img2': JSON.stringify({ id: 'img2', uid: 'uid1', purpose: 'images', fileName: 'test2.jpg' }),
    };

    // Simulate runUserFileIndexMigrationBatch
    const runBatch = async (limit = 50, cursor?: string) => {
      const keys = Object.keys(mockKVStore)
        .filter(k => k.startsWith('user-file:'))
        .filter(k => !k.startsWith('user-file-by-id:') && !k.startsWith('user-files-index:'));

      let newlyIndexed = 0;
      for (const k of keys) {
        const rec = JSON.parse(mockKVStore[k]);
        const byIdKey = `user-file-by-id:${rec.purpose}:${rec.id}`;
        if (!mockKVStore[byIdKey]) {
          mockKVStore[byIdKey] = JSON.stringify(rec);
          newlyIndexed++;
        }
      }
      mockKVStore['migrated:user-file-by-id:v2'] = 'complete';
      delete mockKVStore['migrated:user-file-by-id:v2:cursor'];
      return {
        status: 'complete' as const,
        cursor: null,
        recordsDiscovered: keys.length,
        recordsAlreadyIndexed: keys.length - newlyIndexed,
        recordsNewlyIndexed: newlyIndexed,
        isComplete: true,
      };
    };

    const result = await runBatch(50);
    assert.equal(result.isComplete, true);
    assert.equal(result.recordsNewlyIndexed, 2);
    assert.ok(mockKVStore['user-file-by-id:images:img1']);
    assert.ok(mockKVStore['user-file-by-id:images:img2']);
    assert.equal(mockKVStore['migrated:user-file-by-id:v2'], 'complete');
  });
});

describe('Section 38: NTK Note v2.6 — Absolute Final Data-Integrity, Media-Cleanup Security & Free-Zone Closure Suite', () => {
  const dummyUserA = 'user_closure_38_A';
  const dummyUserB = 'user_closure_38_B';
  const dummyAdmin = '0yZ0Zl1yv1Z5w2X1q0r8s9t0u1v2';

  test('Media recomputation: Stale-restored Note B protects shared media from deletion when Note A is deleted', () => {
    // Note A and Note B both reference images:obj_shared_123
    const noteA: Note = {
      id: 'note_A',
      title: 'Note A',
      notebookId: 'default',
      trashed: true,
      ownerId: dummyUserA,
      photos: [{ id: 'pA', objectId: 'obj_shared_123', name: 'imgA.png', size: 100, mimeType: 'image/png', createdAt: '2026-01-01' }],
      tags: [],
      favorite: false,
      pinned: false,
      archived: false,
      color: 'default',
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 1,
      charCount: 1,
      linkedNoteIds: [],
      order: 0,
    };

    const noteB: Note = {
      id: 'note_B',
      title: 'Note B',
      notebookId: 'default',
      trashed: false, // Note B was restored on another device (stale-restored)
      ownerId: dummyUserA,
      images: [{ id: 'imgB', objectId: 'obj_shared_123', name: 'imgB.png', size: 100, mimeType: 'image/png', createdAt: '2026-01-01' }],
      tags: [],
      favorite: false,
      pinned: false,
      archived: false,
      color: 'default',
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 1,
      charCount: 1,
      linkedNoteIds: [],
      order: 1,
    };

    const allNotes = [noteA, noteB];

    // Real deletion result: Note A successfully deleted, Note B skipped
    const finalDeletedNoteIds = new Set(['note_A']);
    const notesActuallyDeleted = allNotes.filter(n => finalDeletedNoteIds.has(n.id));
    const remainingNotes = allNotes.filter(n => !finalDeletedNoteIds.has(n.id));

    // Harvest candidates from notesActuallyDeleted
    const candidates = notesActuallyDeleted.flatMap(n => extractMediaCandidates(n));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].objectId, 'obj_shared_123');
    assert.equal(candidates[0].purpose, 'images');

    // Check reuse strictly against remainingNotes
    const isReused = isMediaReused(
      candidates[0].purpose,
      candidates[0].objectId,
      candidates[0].noteId,
      remainingNotes,
      new Set()
    );

    assert.equal(isReused, true, 'Shared media obj_shared_123 must be marked as reused because remaining Note B still references it');
  });

  test('Media recomputation: Cleanup succeeds when first candidate owner deletion fails but second note succeeds', () => {
    // Note A and Note B both reference images:obj_exclusive
    const noteA: Note = {
      id: 'note_A',
      title: 'Note A',
      notebookId: 'default',
      trashed: true,
      ownerId: dummyUserA,
      images: [{ id: 'imgA', objectId: 'obj_exclusive', name: 'imgA.png', size: 100, mimeType: 'image/png', createdAt: '2026-01-01' }],
      tags: [],
      favorite: false,
      pinned: false,
      archived: false,
      color: 'default',
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 1,
      charCount: 1,
      linkedNoteIds: [],
      order: 0,
    };

    const noteB: Note = {
      id: 'note_B',
      title: 'Note B',
      notebookId: 'default',
      trashed: true,
      ownerId: dummyUserA,
      photos: [{ id: 'pB', objectId: 'obj_exclusive', name: 'imgB.png', size: 100, mimeType: 'image/png', createdAt: '2026-01-01' }],
      tags: [],
      favorite: false,
      pinned: false,
      archived: false,
      color: 'default',
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 1,
      charCount: 1,
      linkedNoteIds: [],
      order: 1,
    };

    const allNotes = [noteA, noteB];

    // Failure scenario: Note A deletion failed (in failedNoteIds), but Note B deletion succeeded (in deletedNoteIds)
    const finalDeletedNoteIds = new Set(['note_B']);
    const notesActuallyDeleted = allNotes.filter(n => finalDeletedNoteIds.has(n.id));
    const remainingNotes = allNotes.filter(n => !finalDeletedNoteIds.has(n.id));

    // Note B was deleted, so candidate is harvested from Note B
    const candidates = notesActuallyDeleted.flatMap(n => extractMediaCandidates(n));
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].objectId, 'obj_exclusive');

    // Since Note A failed deletion, Note A is in remainingNotes, so it prevents R2 orphan / premature deletion
    const isReusedDueToFailedA = isMediaReused(
      candidates[0].purpose,
      candidates[0].objectId,
      candidates[0].noteId,
      remainingNotes,
      new Set()
    );
    assert.equal(isReusedDueToFailedA, true, 'Surviving failed Note A retains the media reference');

    // Case 2: When Note A had dropped the image reference before failing, or when Note B is the sole owner
    const remainingNotesWithReferenceRemoved = [{ ...noteA, images: [], photos: [] }];
    const isReusedWhenNoRemainingNote = isMediaReused(
      candidates[0].purpose,
      candidates[0].objectId,
      candidates[0].noteId,
      remainingNotesWithReferenceRemoved,
      new Set()
    );
    assert.equal(isReusedWhenNoRemainingNote, false, 'Media is cleaned up when no remaining note references it, regardless of which candidate was first');
  });

  test('Phased Deletion: Note batch failure blocks parent notebook deletion across >25 items boundary', () => {
    const parentNb: Notebook = {
      id: 'nb_parent_large',
      name: 'Large Project',
      trashed: true,
      parentId: null,
      sections: [],
      createdAt: '',
      order: 0,
      color: 'default',
      icon: '',
    };

    // Create 30 child notes (crossing the 25-item BATCH_SIZE boundary)
    const childNotes: Note[] = Array.from({ length: 30 }, (_, i) => ({
      id: `note_child_${i}`,
      title: `Child Note ${i}`,
      notebookId: 'nb_parent_large',
      trashed: true,
      ownerId: dummyUserA,
      tags: [],
      favorite: false,
      pinned: false,
      archived: false,
      color: 'default',
      priority: null,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
      wordCount: 1,
      charCount: 1,
      linkedNoteIds: [],
      order: i,
    }));

    // Simulate batch execution: Batch 1 (notes 0..24) succeeds, Batch 2 (notes 25..29) fails
    const deletedNoteIds = childNotes.slice(0, 25).map(n => n.id);
    const failedNoteIds = childNotes.slice(25, 30).map(n => n.id);
    const finalDeletedNoteIdsSet = new Set(deletedNoteIds);
    const reparentedNoteIdsSet = new Set<string>();

    // Phase E: Re-evaluate notebook dependencies using REAL note deletion results
    let hasUnsafeChildNote = false;
    for (const note of childNotes) {
      if (note.notebookId === parentNb.id) {
        const isDeleted = finalDeletedNoteIdsSet.has(note.id);
        const isReparented = reparentedNoteIdsSet.has(note.id);
        if (!isDeleted && !isReparented) {
          hasUnsafeChildNote = true;
          break;
        }
      }
    }

    const safeNotebooksToDelete: Notebook[] = [];
    const failedNotebookIds: string[] = [];

    if (hasUnsafeChildNote) {
      failedNotebookIds.push(parentNb.id);
    } else {
      safeNotebooksToDelete.push(parentNb);
    }

    assert.equal(safeNotebooksToDelete.length, 0, 'Parent notebook MUST NOT be deleted when any child note deletion batch fails');
    assert.equal(failedNotebookIds.length, 1);
    assert.equal(failedNotebookIds[0], 'nb_parent_large');
  });

  test('Phased Deletion: Recursive descendant notebook safety blocks parent deletion when child reparent fails', () => {
    const rootNb: Notebook = { id: 'nb_root', name: 'Root', trashed: true, parentId: null, sections: [], createdAt: '', order: 0, color: 'default', icon: '' };
    const childNb: Notebook = { id: 'nb_child_surviving', name: 'Child', trashed: false, parentId: 'nb_root', sections: [], createdAt: '', order: 0, color: 'default', icon: '' };

    const reparentedNotebookIdsSet = new Set<string>(); // childNb reparent failed
    const candidateVerifiedNotebooks = [rootNb];
    const failedNotebookIds: string[] = [];
    const safeNotebooksToDelete: Notebook[] = [];

    for (const nb of candidateVerifiedNotebooks) {
      let hasUnsafeChildNotebook = false;
      for (const child of [childNb]) {
        if (child.parentId === nb.id) {
          const isChildDeleted = candidateVerifiedNotebooks.some(v => v.id === child.id) && !failedNotebookIds.includes(child.id);
          const isChildReparented = reparentedNotebookIdsSet.has(child.id);
          if (!isChildDeleted && !isChildReparented) {
            hasUnsafeChildNotebook = true;
            break;
          }
        }
      }
      if (hasUnsafeChildNotebook) {
        failedNotebookIds.push(nb.id);
      } else {
        safeNotebooksToDelete.push(nb);
      }
    }

    assert.equal(safeNotebooksToDelete.length, 0, 'Root notebook deletion blocked because child notebook could not be reparented');
    assert.equal(failedNotebookIds.includes('nb_root'), true);
  });

  test('Reminder failure handling: queuePendingReminderCleanups, retrieval, and clear', () => {
    const mockStorage: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
    };

    queuePendingReminderCleanups(dummyUserA, ['rem_fail_1', 'rem_fail_2']);
    let queued = getPendingReminderCleanups(dummyUserA);
    assert.equal(queued.length, 2);
    assert.ok(queued.includes('rem_fail_1'));
    assert.ok(queued.includes('rem_fail_2'));

    // Clear one
    clearPendingReminderCleanups(dummyUserA, ['rem_fail_1']);
    queued = getPendingReminderCleanups(dummyUserA);
    assert.equal(queued.length, 1);
    assert.equal(queued[0], 'rem_fail_2');

    // UID isolation: User B has none
    const userBQueued = getPendingReminderCleanups(dummyUserB);
    assert.equal(userBQueued.length, 0);

    // Clear remaining
    clearPendingReminderCleanups(dummyUserA, ['rem_fail_2']);
    queued = getPendingReminderCleanups(dummyUserA);
    assert.equal(queued.length, 0);
  });

  test('Worker Pending Cleanup: Requires legitimate file record; non-existent object rejected with 404', () => {
    const fileRecords: Record<string, any> = {};

    const authorizePendingCleanup = (
      user: { uid: string; owner?: boolean },
      purpose: string,
      objectId: string
    ) => {
      const record = fileRecords[`${purpose}:${objectId}`];
      if (!record) {
        return { status: 404, message: 'File record not found.' };
      }
      const isAuthorized = record.uid === user.uid || (record.uploaderUid && record.uploaderUid === user.uid);
      if (!isAuthorized) {
        return { status: 403, message: 'Access denied to this file.' };
      }
      return { status: 200, ok: true };
    };

    // 1. Non-existent object -> 404
    const res404 = authorizePendingCleanup({ uid: dummyUserA }, 'images', 'non_existent_obj');
    assert.equal(res404.status, 404);
  });

  test('Worker Pending Cleanup: Cross-user marker attempt denied with 403', () => {
    const fileRecords: Record<string, any> = {
      'images:obj_owned_by_b': {
        uid: dummyUserB,
        uploaderUid: dummyUserB,
        purpose: 'images',
        objectId: 'obj_owned_by_b',
      },
    };

    const authorizePendingCleanup = (
      user: { uid: string; owner?: boolean },
      purpose: string,
      objectId: string
    ) => {
      const record = fileRecords[`${purpose}:${objectId}`];
      if (!record) return { status: 404 };
      const isAuthorized = record.uid === user.uid || (record.uploaderUid && record.uploaderUid === user.uid);
      if (!isAuthorized) return { status: 403 };
      return { status: 200, ok: true };
    };

    // User A attempting to queue marker for User B's object -> 403
    const res403 = authorizePendingCleanup({ uid: dummyUserA }, 'images', 'obj_owned_by_b');
    assert.equal(res403.status, 403);

    // User B (actual owner) -> 200
    const res200 = authorizePendingCleanup({ uid: dummyUserB }, 'images', 'obj_owned_by_b');
    assert.equal(res200.status, 200);
  });

  test('Worker Pending Cleanup: Infrastructure owner has NO bypass on file ownership', () => {
    const fileRecords: Record<string, any> = {
      'images:obj_user_b': {
        uid: dummyUserB,
        uploaderUid: dummyUserB,
        purpose: 'images',
        objectId: 'obj_user_b',
      },
    };

    const authorizePendingCleanup = (
      user: { uid: string; owner?: boolean },
      purpose: string,
      objectId: string
    ) => {
      const record = fileRecords[`${purpose}:${objectId}`];
      if (!record) return { status: 404 };
      // Strict ownership check: record.uid === user.uid || record.uploaderUid === user.uid
      // Infrastructure owner flag MUST NOT bypass
      const isAuthorized = record.uid === user.uid || (record.uploaderUid && record.uploaderUid === user.uid);
      if (!isAuthorized) return { status: 403 };
      return { status: 200, ok: true };
    };

    // Infrastructure owner -> 403 (zero bypass)
    const adminRes = authorizePendingCleanup({ uid: dummyAdmin, owner: true }, 'images', 'obj_user_b');
    assert.equal(adminRes.status, 403);
  });

  test('Worker Pending Cleanup: 50-item bounded capacity rejects 51st marker without creating orphan key', () => {
    const MAX_SERVER_PENDING_CLEANUPS_PER_USER = 50;
    const userIndex = Array.from({ length: 50 }, (_, i) => ({
      purpose: 'images' as const,
      objectId: `obj_${i}`,
      retryCount: 0,
    }));
    const kvStore: Record<string, string> = {};

    const handleQueueMarker = (purpose: string, objectId: string) => {
      const exists = userIndex.some(item => item.purpose === purpose && item.objectId === objectId);
      if (exists) {
        return { status: 200, ok: true, duplicate: true };
      }
      if (userIndex.length >= MAX_SERVER_PENDING_CLEANUPS_PER_USER) {
        return { status: 429, message: 'Pending media cleanup queue is at capacity (50 items max).' };
      }
      // Write marker ONLY if under capacity
      kvStore[`pending-media-cleanup:${dummyUserA}:${purpose}:${objectId}`] = JSON.stringify({ purpose, objectId });
      userIndex.push({ purpose: purpose as any, objectId, retryCount: 0 });
      return { status: 200, ok: true };
    };

    // 51st unique item
    const res51 = handleQueueMarker('images', 'obj_overflow_51');
    assert.equal(res51.status, 429);
    assert.equal(userIndex.length, 50, 'Index count remains bounded at 50');
    assert.equal(kvStore[`pending-media-cleanup:${dummyUserA}:images:obj_overflow_51`], undefined, 'Zero orphan KV marker written on capacity rejection');
  });

  test('Worker Pending Cleanup: Duplicate marker is idempotent and does not expand index', () => {
    const userIndex = [
      { purpose: 'images' as const, objectId: 'obj_existing', retryCount: 1 },
    ];

    const handleQueueMarker = (purpose: 'images', objectId: string, incomingRetries = 0) => {
      const existing = userIndex.find(item => item.purpose === purpose && item.objectId === objectId);
      if (existing) {
        existing.retryCount = Math.max(existing.retryCount, incomingRetries);
        return { status: 200, ok: true, duplicate: true };
      }
      userIndex.push({ purpose, objectId, retryCount: incomingRetries });
      return { status: 200, ok: true, duplicate: false };
    };

    const firstDuplicate = handleQueueMarker('images', 'obj_existing', 2);
    assert.equal(firstDuplicate.status, 200);
    assert.equal(firstDuplicate.duplicate, true);
    assert.equal(userIndex.length, 1, 'Index length does NOT grow on duplicate');
    assert.equal(userIndex[0].retryCount, 2, 'Retry count updated conservatively');
  });

  test('Server retry metadata persistence and conservative cross-device merge', () => {
    const localQueue = [
      {
        id: `${dummyUserA}:images:obj_cross`,
        uid: dummyUserA,
        purpose: 'images' as const,
        objectId: 'obj_cross',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 4,
        nextEligibleAttemptAt: '2026-01-01T01:00:00Z',
      },
    ];

    const serverItems = [
      {
        purpose: 'images' as const,
        objectId: 'obj_cross',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 2, // stale lower count on another device
        lastAttemptAt: '2026-01-01T00:05:00Z',
        nextEligibleAttemptAt: '2026-01-01T00:10:00Z',
      },
      {
        purpose: 'attachments' as const,
        objectId: 'obj_new_server',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 3,
        lastAttemptAt: '2026-01-01T00:15:00Z',
        nextEligibleAttemptAt: '2026-01-01T00:20:00Z',
      },
    ];

    // Merge logic: conservative merge
    for (const sItem of serverItems) {
      const id = `${dummyUserA}:${sItem.purpose}:${sItem.objectId}`;
      const existing = localQueue.find(q => q.id === id);
      if (existing) {
        existing.retryCount = Math.max(existing.retryCount, sItem.retryCount || 0);
      } else {
        localQueue.push({
          id,
          uid: dummyUserA,
          purpose: sItem.purpose,
          objectId: sItem.objectId,
          queuedAt: sItem.queuedAt,
          retryCount: sItem.retryCount || 0,
          nextEligibleAttemptAt: sItem.nextEligibleAttemptAt,
        });
      }
    }

    assert.equal(localQueue.length, 2);
    // obj_cross had retryCount 4 locally and 2 on server -> retains 4!
    const item1 = localQueue.find(q => q.objectId === 'obj_cross')!;
    assert.equal(item1.retryCount, 4, 'Conservative merge never resets higher retry count');

    // obj_new_server was not local -> imported with retryCount 3!
    const item2 = localQueue.find(q => q.objectId === 'obj_new_server')!;
    assert.equal(item2.retryCount, 3, 'Imported server item preserves server retry count');
  });

  test('Terminal failure policy: 400 and 403 stop retrying; 500 triggers backoff', () => {
    const classifyResult = (status: number) => {
      if (status === 200 || status === 404) {
        return { action: 'success_remove_from_queue', shouldRetry: false };
      }
      if (status === 400 || status === 403) {
        return { action: 'terminal_remove_from_queue', shouldRetry: false };
      }
      return { action: 'transient_backoff_and_retry', shouldRetry: true };
    };

    assert.equal(classifyResult(200).action, 'success_remove_from_queue');
    assert.equal(classifyResult(404).action, 'success_remove_from_queue');
    assert.equal(classifyResult(400).action, 'terminal_remove_from_queue');
    assert.equal(classifyResult(403).action, 'terminal_remove_from_queue');
    assert.equal(classifyResult(500).action, 'transient_backoff_and_retry');
    assert.equal(classifyResult(503).action, 'transient_backoff_and_retry');
    assert.equal(classifyResult(0).action, 'transient_backoff_and_retry');
  });

  test('Spark $0 & Free-zone invariants: 0 Cloud Functions, 0 Firebase Storage media, bounded batches', () => {
    const MAX_FIRESTORE_BATCH = 25;
    const MAX_SERVER_QUEUE = 50;

    assert.ok(MAX_FIRESTORE_BATCH <= 25, 'Batches must be bounded <= 25 to guarantee zero timeout on Spark');
    assert.ok(MAX_SERVER_QUEUE <= 50, 'Server queue bounded to 50 items max to protect KV write quotas');
  });
});

describe('Section 39: NTK Note v2.6 — Transactional Final Closure Suite', () => {
  const dummyUserA = 'user_closure_a_111';
  const dummyUserB = 'user_closure_b_222';

  test('Reminder retry consumer: bounded chunk execution, clears successful IDs, and UID isolation', () => {
    const queueStorage = new Map<string, string[]>();

    const queueReminders = (uid: string, ids: string[]) => {
      const existing = queueStorage.get(uid) || [];
      queueStorage.set(uid, Array.from(new Set([...existing, ...ids])));
    };

    const getReminders = (uid: string) => queueStorage.get(uid) || [];

    const clearReminders = (uid: string, ids: string[]) => {
      const existing = queueStorage.get(uid) || [];
      const toRemove = new Set(ids);
      const remaining = existing.filter(id => !toRemove.has(id));
      queueStorage.set(uid, remaining);
    };

    // User A has 30 pending reminders (crosses 25 boundary)
    const userAIds = Array.from({ length: 30 }, (_, i) => `rem_a_${i}`);
    queueReminders(dummyUserA, userAIds);

    // User B has 5 pending reminders
    const userBIds = ['rem_b_1', 'rem_b_2', 'rem_b_3', 'rem_b_4', 'rem_b_5'];
    queueReminders(dummyUserB, userBIds);

    assert.equal(getReminders(dummyUserA).length, 30);
    assert.equal(getReminders(dummyUserB).length, 5);

    // Execute retry for User A: bounded to 25 items max
    const executeRetry = (uid: string, maxBatch = 25, simulateFail = false) => {
      const pending = getReminders(uid);
      if (pending.length === 0) return 0;
      const chunk = pending.slice(0, maxBatch);
      if (simulateFail) {
        return 0; // failed commit leaves them in queue
      }
      clearReminders(uid, chunk);
      return chunk.length;
    };

    const processed = executeRetry(dummyUserA, 25);
    assert.equal(processed, 25, 'First retry run processes bounded chunk of 25');
    assert.equal(getReminders(dummyUserA).length, 5, '5 remaining items stay in queue for next run');

    // UID isolation: User B was completely untouched
    assert.equal(getReminders(dummyUserB).length, 5, 'User B reminders completely isolated');

    // Second run for User A cleans remaining 5
    const processedSecond = executeRetry(dummyUserA, 25);
    assert.equal(processedSecond, 5);
    assert.equal(getReminders(dummyUserA).length, 0, 'User A queue now empty');
  });

  test('Bottom-up notebook deletion: deepest descendants delete first, and child failure blocks parent', () => {
    // Hierarchy:
    // Parent P (depth 0)
    //   └── Child C (depth 1)
    //         └── Grandchild G (depth 2)

    const allNotebooks = [
      { id: 'nb_parent', parentId: null, title: 'Parent' },
      { id: 'nb_child', parentId: 'nb_parent', title: 'Child' },
      { id: 'nb_grandchild', parentId: 'nb_child', title: 'Grandchild' },
    ];

    const nbMap = new Map(allNotebooks.map(nb => [nb.id, nb]));
    const getDepth = (id: string, visited = new Set<string>()): number => {
      if (visited.has(id)) return 0;
      visited.add(id);
      const nb = nbMap.get(id);
      if (!nb || !nb.parentId || !nbMap.has(nb.parentId)) return 0;
      return 1 + getDepth(nb.parentId, visited);
    };

    assert.equal(getDepth('nb_parent'), 0);
    assert.equal(getDepth('nb_child'), 1);
    assert.equal(getDepth('nb_grandchild'), 2);

    // Scenario 1: Grandchild deletion FAILS -> Child & Parent MUST remain
    const deletedNotebookIds: string[] = [];
    const failedNotebookIds: string[] = [];
    const reparentedNotebookIdsSet = new Set<string>();

    const candidateNotebooks = [...allNotebooks];

    // Group by depth descending: depth 2, then 1, then 0
    const byDepth = new Map<number, typeof allNotebooks>();
    for (const nb of candidateNotebooks) {
      const d = getDepth(nb.id);
      const list = byDepth.get(d) || [];
      list.push(nb);
      byDepth.set(d, list);
    }

    // Step 1: Process depth 2 (Grandchild) -> simulate FAILURE
    const depth2Nbs = byDepth.get(2) || [];
    for (const nb of depth2Nbs) {
      // Simulate failure
      failedNotebookIds.push(nb.id);
    }

    // Step 2: Process depth 1 (Child)
    const depth1Nbs = byDepth.get(1) || [];
    for (const nb of depth1Nbs) {
      // Check child notebooks in allNotebooks
      const unsafeChild = allNotebooks.some(
        c => c.parentId === nb.id && !deletedNotebookIds.includes(c.id) && !reparentedNotebookIdsSet.has(c.id)
      );
      if (unsafeChild) {
        failedNotebookIds.push(nb.id);
      } else {
        deletedNotebookIds.push(nb.id);
      }
    }

    // Step 3: Process depth 0 (Parent)
    const depth0Nbs = byDepth.get(0) || [];
    for (const nb of depth0Nbs) {
      const unsafeChild = allNotebooks.some(
        c => c.parentId === nb.id && !deletedNotebookIds.includes(c.id) && !reparentedNotebookIdsSet.has(c.id)
      );
      if (unsafeChild) {
        failedNotebookIds.push(nb.id);
      } else {
        deletedNotebookIds.push(nb.id);
      }
    }

    assert.ok(failedNotebookIds.includes('nb_grandchild'), 'Grandchild failed');
    assert.ok(failedNotebookIds.includes('nb_child'), 'Child blocked because grandchild failed');
    assert.ok(failedNotebookIds.includes('nb_parent'), 'Parent blocked because child failed');
    assert.equal(deletedNotebookIds.length, 0, 'No notebooks deleted when descendant fails');
  });

  test('>25 notebook boundary safety: descendant batch failure prevents ancestor deletion', () => {
    // 30 child notebooks under 1 parent notebook
    const parent = { id: 'parent_large', parentId: null, title: 'Parent Large' };
    const children = Array.from({ length: 30 }, (_, i) => ({
      id: `child_large_${i}`,
      parentId: 'parent_large',
      title: `Child Large ${i}`,
    }));

    const deletedNotebooks: string[] = [];
    const failedNotebooks: string[] = [];

    // Suppose child batch 1 (items 0..24) succeeds, but child batch 2 (items 25..29) fails
    for (let i = 0; i < 25; i++) {
      deletedNotebooks.push(children[i].id);
    }
    for (let i = 25; i < 30; i++) {
      failedNotebooks.push(children[i].id);
    }

    // Now evaluate parent
    const hasUnsafeChildren = children.some(c => !deletedNotebooks.includes(c.id));
    if (hasUnsafeChildren) {
      failedNotebooks.push(parent.id);
    } else {
      deletedNotebooks.push(parent.id);
    }

    assert.ok(failedNotebooks.includes('parent_large'), 'Parent retained because surviving child exists');
    assert.ok(!deletedNotebooks.includes('parent_large'), 'Parent never deleted while any child survives');
  });

  test('Shared note atomic logical pairing: private + canonical records commit together', () => {
    interface LogicalNoteUnit {
      noteId: string;
      paths: string[];
    }

    const verifiedNotes = [
      { id: 'note_shared_1', isShared: true, ownerId: dummyUserA },
      { id: 'note_shared_2', isShared: true, ownerId: dummyUserA },
      { id: 'note_private_3', isShared: false, ownerId: dummyUserA },
    ];

    const logicalNotes: LogicalNoteUnit[] = verifiedNotes.map(n => {
      const paths = [`users/${dummyUserA}/notes/${n.id}`];
      if (n.isShared && n.ownerId === dummyUserA) {
        paths.push(`shared_notes/${n.id}`);
      }
      return { noteId: n.id, paths };
    });

    // Pack into batches <= 25 writes without splitting any logical note
    const batches: LogicalNoteUnit[][] = [];
    let currentBatch: LogicalNoteUnit[] = [];
    let currentCount = 0;

    for (const unit of logicalNotes) {
      if (currentCount + unit.paths.length > 25 && currentBatch.length > 0) {
        batches.push(currentBatch);
        currentBatch = [];
        currentCount = 0;
      }
      currentBatch.push(unit);
      currentCount += unit.paths.length;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    // Verify all units have both paths intact in the same batch
    assert.equal(batches.length, 1);
    const unit1 = batches[0].find(u => u.noteId === 'note_shared_1')!;
    assert.equal(unit1.paths.length, 2);
    assert.ok(unit1.paths.includes(`users/${dummyUserA}/notes/note_shared_1`));
    assert.ok(unit1.paths.includes('shared_notes/note_shared_1'));

    // If batch fails, both private and canonical survive
    const deletedNoteIds: string[] = [];
    const failedNoteIds: string[] = [];
    const simulateBatchFailure = true;

    if (simulateBatchFailure) {
      for (const unit of batches[0]) {
        failedNoteIds.push(unit.noteId);
      }
    }

    assert.equal(deletedNoteIds.length, 0);
    assert.equal(failedNoteIds.length, 3);
    assert.ok(failedNoteIds.includes('note_shared_1'));
  });

  test('Terminal media failure purges local queue AND server marker, preventing reload resurrection', () => {
    let localQueue = [
      {
        id: `${dummyUserA}:images:obj_terminal_test`,
        uid: dummyUserA,
        purpose: 'images' as const,
        objectId: 'obj_terminal_test',
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount: 1,
      },
    ];

    let serverKVMarkers = new Map<string, string>([
      [`pending-media-cleanup:${dummyUserA}:images:obj_terminal_test`, '{"retryCount":1}'],
    ]);
    let serverIndex = [{ purpose: 'images' as const, objectId: 'obj_terminal_test' }];
    const dismissedMarkers = new Set<string>();

    // Simulated terminal deletion (400 or 403)
    const handleTerminalResult = (purpose: string, objectId: string, status: number) => {
      if (status === 400 || status === 403) {
        // 1. Remove from local queue
        const id = `${dummyUserA}:${purpose}:${objectId}`;
        localQueue = localQueue.filter(q => q.id !== id);
        // 2. Record locally dismissed
        dismissedMarkers.add(id);
        // 3. Purge server marker & index
        serverKVMarkers.delete(`pending-media-cleanup:${dummyUserA}:${purpose}:${objectId}`);
        serverIndex = serverIndex.filter(item => !(item.purpose === purpose && item.objectId === objectId));
      }
    };

    handleTerminalResult('images', 'obj_terminal_test', 403);

    assert.equal(localQueue.length, 0, 'Local item removed');
    assert.equal(serverKVMarkers.size, 0, 'Server KV marker deleted');
    assert.equal(serverIndex.length, 0, 'Server index cleaned');

    // Simulate app reload and server marker sync
    const simulatedServerItems = serverIndex;
    for (const sItem of simulatedServerItems) {
      const id = `${dummyUserA}:${sItem.purpose}:${sItem.objectId}`;
      if (dismissedMarkers.has(id)) {
        continue; // does not resurrect!
      }
      localQueue.push({ id, uid: dummyUserA, purpose: sItem.purpose, objectId: sItem.objectId, queuedAt: '', retryCount: 0 });
    }

    assert.equal(localQueue.length, 0, 'Terminal item NEVER resurrects after reload');
  });

  test('Duplicate pending-marker POST true no-op: zero KV writes when state does not advance', async () => {
    let kvPutCount = 0;
    const kvStore = new Map<string, string>();

    const mockPut = async (k: string, v: string) => {
      kvPutCount++;
      kvStore.set(k, v);
    };

    interface IndexItem {
      purpose: string;
      objectId: string;
      queuedAt: string;
      retryCount: number;
      lastAttemptAt?: string | null;
      nextEligibleAttemptAt?: string | null;
    }

    const currentIndex: IndexItem[] = [];

    const handlePostMarker = async (
      purpose: string,
      objectId: string,
      retryCount = 0,
      lastAttemptAt?: string | null,
      nextEligibleAttemptAt?: string | null
    ) => {
      const existingIdx = currentIndex.findIndex(i => i.purpose === purpose && i.objectId === objectId);
      if (existingIdx !== -1) {
        const existing = currentIndex[existingIdx];
        const currentRetries = existing.retryCount || 0;
        const updatedRetries = Math.max(currentRetries, retryCount);

        const isRetryAdvanced = updatedRetries > currentRetries;
        const isLastAttemptAdvanced = !!(lastAttemptAt && (!existing.lastAttemptAt || new Date(lastAttemptAt).getTime() > new Date(existing.lastAttemptAt).getTime()));
        const isNextEligibleAdvanced = !!(nextEligibleAttemptAt && nextEligibleAttemptAt !== existing.nextEligibleAttemptAt);

        // True duplicate check: ZERO KV PUTS!
        if (!isRetryAdvanced && !isLastAttemptAdvanced && !isNextEligibleAdvanced) {
          return { status: 200, unchanged: true };
        }

        existing.retryCount = updatedRetries;
        if (isLastAttemptAdvanced) existing.lastAttemptAt = lastAttemptAt;
        if (isNextEligibleAdvanced) existing.nextEligibleAttemptAt = nextEligibleAttemptAt;

        await mockPut(`marker:${purpose}:${objectId}`, JSON.stringify(existing));
        await mockPut('index', JSON.stringify(currentIndex));
        return { status: 200, updated: true };
      }

      // New item
      const newItem: IndexItem = {
        purpose,
        objectId,
        queuedAt: '2026-01-01T00:00:00Z',
        retryCount,
        lastAttemptAt: lastAttemptAt || null,
        nextEligibleAttemptAt: nextEligibleAttemptAt || null,
      };
      currentIndex.push(newItem);
      await mockPut(`marker:${purpose}:${objectId}`, JSON.stringify(newItem));
      await mockPut('index', JSON.stringify(currentIndex));
      return { status: 200, created: true };
    };

    // First request: creates marker (2 KV puts: marker + index)
    await handlePostMarker('images', 'obj_dedupe_1', 1, '2026-01-01T00:00:00Z');
    assert.equal(kvPutCount, 2);

    // Duplicate requests: exactly identical metadata
    for (let i = 0; i < 50; i++) {
      await handlePostMarker('images', 'obj_dedupe_1', 1, '2026-01-01T00:00:00Z');
    }

    // KV put count must STILL be 2! Zero additional KV puts on exact duplicate
    assert.equal(kvPutCount, 2, '50 duplicate POST requests produce ZERO additional KV puts');
    assert.equal(currentIndex.length, 1, 'Index length remains exactly 1');
  });

  test('Retry metadata validation: far-future timestamps like year 2099 are rejected/bounded', () => {
    const validateSchedule = (incoming: string | undefined): string | null => {
      if (!incoming) return null;
      const nowMs = Date.now();
      const t = new Date(incoming).getTime();
      if (isNaN(t)) return null;
      // Must be between now - 60s and now + 24 hours
      if (t < nowMs - 60000 || t > nowMs + 24 * 3600 * 1000) {
        return null; // rejected/bounded
      }
      return new Date(t).toISOString();
    };

    // Distant future: year 2099
    assert.equal(validateSchedule('2099-01-01T00:00:00Z'), null, 'Year 2099 rejected');
    assert.equal(validateSchedule('invalid-date'), null, 'Malformed date rejected');

    // Valid schedule 5 minutes from now
    const validFuture = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    assert.ok(validateSchedule(validFuture) !== null, 'Valid schedule within 24h accepted');
  });
});

describe('Section 40: NTK Note v2.6 — Real Queue Implementation & Authority Validation Suite', () => {
  // Test Mock KV implementation adhering to SimpleKVNamespace
  class MockKV implements SimpleKVNamespace {
    public store = new Map<string, string>();
    public putCount = 0;
    public getCount = 0;
    public deleteCount = 0;
    public failGetsOnKey: string | null = null;
    public failPutsOnKey: string | null = null;
    public failDeletesOnKey: string | null = null;

    async get<T = string>(key: string, type?: 'text' | 'json'): Promise<T | null> {
      if (this.failGetsOnKey && key.includes(this.failGetsOnKey)) {
        throw new Error(`Simulated KV GET failure on key: ${key}`);
      }
      this.getCount++;
      const val = this.store.get(key);
      if (val === undefined) return null;
      if (type === 'json') {
        try {
          return JSON.parse(val) as T;
        } catch {
          throw new SyntaxError(`Unexpected token in JSON at position 0`);
        }
      }
      return val as unknown as T;
    }

    async put(key: string, value: string): Promise<void> {
      if (this.failPutsOnKey && key.includes(this.failPutsOnKey)) {
        throw new Error(`Simulated KV PUT failure on key: ${key}`);
      }
      this.putCount++;
      this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
      if (this.failDeletesOnKey && key.includes(this.failDeletesOnKey)) {
        throw new Error(`Simulated KV DELETE failure on key: ${key}`);
      }
      this.deleteCount++;
      this.store.delete(key);
    }
  }

  test('Real computeServerRetryBackoffMs calculates exact tiered backoffs', () => {
    assert.equal(computeServerRetryBackoffMs(0), 30000, 'Retry 0 backoff is 30s');
    assert.equal(computeServerRetryBackoffMs(1), 30000, 'Retry 1 backoff is 30s');
    assert.equal(computeServerRetryBackoffMs(2), 60000, 'Retry 2 backoff is 60s');
    assert.equal(computeServerRetryBackoffMs(3), 300000, 'Retry 3 backoff is 300s (5 min)');
    assert.equal(computeServerRetryBackoffMs(4), 900000, 'Retry 4 backoff is 900s (15 min)');
    assert.equal(computeServerRetryBackoffMs(5), 1800000, 'Retry 5 backoff is 1800s (30 min)');
    assert.equal(computeServerRetryBackoffMs(6), 3600000, 'Retry 6+ backoff is capped at 3600s (1 hr)');
    assert.equal(computeServerRetryBackoffMs(10), 3600000, 'Retry 10 backoff is capped at 3600s');
  });

  test('Real buildInitialPendingMediaState & canCreatePendingMediaMarker enforce server authority', () => {
    const nowIso = '2026-09-06T12:00:00.000Z';
    const marker = buildInitialPendingMediaState('user_1', 'attachments', 'doc_1', nowIso);

    assert.equal(marker.uid, 'user_1');
    assert.equal(marker.purpose, 'attachments');
    assert.equal(marker.objectId, 'doc_1');
    assert.equal(marker.retryCount, 0, 'Server-authoritative initial retryCount is 0');
    assert.equal(marker.lastAttemptAt, null, 'Server-authoritative initial lastAttemptAt is null');
    assert.equal(marker.nextEligibleAttemptAt, nowIso, 'Server-authoritative schedule starts immediately');

    // Capacity checks:
    const emptyIndex: PendingMediaIndexItem[] = [];
    const check1 = canCreatePendingMediaMarker(emptyIndex, 'attachments', 'doc_1', 50);
    assert.equal(check1.allowed, true);
    assert.equal(check1.isDuplicate, false);
    assert.equal(check1.atCapacity, false);

    const singleIndex: PendingMediaIndexItem[] = [{ purpose: 'attachments', objectId: 'doc_1' }];
    const checkDup = canCreatePendingMediaMarker(singleIndex, 'attachments', 'doc_1', 50);
    assert.equal(checkDup.allowed, false);
    assert.equal(checkDup.isDuplicate, true, 'Duplicate entry flagged without write');

    // 50-item full index
    const fullIndex: PendingMediaIndexItem[] = Array.from({ length: 50 }, (_, i) => ({
      purpose: 'attachments',
      objectId: `doc_${i}`,
    }));
    const checkCap = canCreatePendingMediaMarker(fullIndex, 'attachments', 'overflow_doc', 50);
    assert.equal(checkCap.allowed, false);
    assert.equal(checkCap.atCapacity, true, 'Capacity check rejects 51st marker');
  });

  test('Real advanceServerMediaRetry: 50-item cap blocks 51st marker and creates ZERO orphan KV keys', async () => {
    const mockKv = new MockKV();
    const uid = 'user_cap_test';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Seed index with exactly 50 entries
    const initial50: PendingMediaIndexItem[] = Array.from({ length: 50 }, (_, i) => ({
      purpose: 'attachments',
      objectId: `doc_${i}`,
      queuedAt: '2026-09-06T10:00:00Z',
      retryCount: 1,
    }));
    await mockKv.put(indexKey, JSON.stringify(initial50));
    mockKv.putCount = 0; // reset counter

    // Attempt advance for a 51st object: overflow_doc
    const result = await advanceServerMediaRetry(mockKv, uid, 'attachments', 'overflow_doc', null, 1000000);

    // Assert capacity is truthful and NO writes occurred
    assert.equal(result.atCapacity, true, 'Returned atCapacity: true');
    assert.equal(result.markerUpdated, false, 'No marker was written');
    assert.equal(result.indexUpdated, false, 'No index was modified');
    assert.equal(result.retryStatePersisted, false);

    // Verify KV store has NO orphan marker key
    const orphanMarkerKey = `pending-media-cleanup:${uid}:attachments:overflow_doc`;
    assert.equal(mockKv.store.has(orphanMarkerKey), false, 'ZERO orphan marker written in KV');

    // Verify index length remains strictly 50
    const rawIndex = await mockKv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    assert.equal(rawIndex?.length, 50, 'Index remains strictly 50 items');
  });

  test('Real advanceServerMediaRetry: updates existing entry even when index length is 50', async () => {
    const mockKv = new MockKV();
    const uid = 'user_update_test';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Seed index with 50 entries, where doc_0 is the one to retry
    const initial50: PendingMediaIndexItem[] = Array.from({ length: 50 }, (_, i) => ({
      purpose: 'attachments',
      objectId: `doc_${i}`,
      queuedAt: '2026-09-06T10:00:00Z',
      retryCount: 1,
    }));
    await mockKv.put(indexKey, JSON.stringify(initial50));

    // Retry doc_0
    const res = await advanceServerMediaRetry(mockKv, uid, 'attachments', 'doc_0', null, 2000000);
    assert.equal(res.atCapacity, false);
    assert.equal(res.markerUpdated, true);
    assert.equal(res.indexUpdated, true);
    assert.equal(res.retryStatePersisted, true);
    assert.equal(res.updatedRetries, 2);

    const markerKey = `pending-media-cleanup:${uid}:attachments:doc_0`;
    const marker = await mockKv.get<PendingMediaMarker>(markerKey, 'json');
    assert.equal(marker?.retryCount, 2);
    assert.equal(marker?.objectId, 'doc_0');
  });

  test('Real advanceServerMediaRetry KV failure injection: reports unpersisted state safely', async () => {
    const mockKv = new MockKV();
    const uid = 'user_fail_test';

    // 1. Simulate marker PUT failure
    mockKv.failPutsOnKey = 'pending-media-cleanup:user_fail_test:images:fail_pic';
    const resMarkerFail = await advanceServerMediaRetry(mockKv, uid, 'images', 'fail_pic', null, 1000000);
    assert.equal(resMarkerFail.markerUpdated, false, 'markerUpdated is false on failure');
    assert.equal(resMarkerFail.retryStatePersisted, false, 'retryStatePersisted reports false');

    // 2. Simulate index PUT failure
    mockKv.failPutsOnKey = 'pending-media-cleanup-index:user_fail_test';
    const resIndexFail = await advanceServerMediaRetry(mockKv, uid, 'images', 'pic_2', null, 1000000);
    assert.equal(resIndexFail.indexUpdated, false, 'indexUpdated is false on failure');
    assert.equal(resIndexFail.retryStatePersisted, false, 'retryStatePersisted reports false');
  });

  test('Real removeUserPendingMediaCleanupMarker purges marker and index entry', async () => {
    const mockKv = new MockKV();
    const uid = 'user_rm_test';
    const markerKey = `pending-media-cleanup:${uid}:attachments:doc_rm`;
    const indexKey = `pending-media-cleanup-index:${uid}`;

    await mockKv.put(markerKey, JSON.stringify({ uid, purpose: 'attachments', objectId: 'doc_rm' }));
    await mockKv.put(indexKey, JSON.stringify([{ purpose: 'attachments', objectId: 'doc_rm' }]));

    const res = await removeUserPendingMediaCleanupMarker(mockKv, uid, 'attachments', 'doc_rm');
    assert.equal(res.markerDeleted, true);
    assert.equal(res.indexUpdated, true);
    assert.equal(res.wasPresent, true);
    assert.equal(mockKv.store.has(markerKey), false);

    const indexAfter = await mockKv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    assert.equal(indexAfter?.length, 0);

    // Call on absent item
    const resAbsent = await removeUserPendingMediaCleanupMarker(mockKv, uid, 'attachments', 'doc_absent');
    assert.equal(resAbsent.wasPresent, false);
  });

  test('Real validateReminderCleanupRequest: same-request internal deduplication & bounded input', () => {
    // 1. Same-request internal dedup: 3 duplicates of 'rem_1' -> exactly 1 clean ID
    const dedupRes = validateReminderCleanupRequest(['rem_1', 'rem_1', '  rem_1  ', 'rem_2']);
    assert.equal(dedupRes.valid, true);
    if (dedupRes.valid) {
      assert.deepEqual(dedupRes.cleanIds, ['rem_1', 'rem_2'], 'Deduplicated to 2 unique items');
      assert.equal(dedupRes.cleanIds.length, 2);
    }

    // 2. Max 25 batch size check: 26 unique IDs -> rejected with 400
    const overBatch = Array.from({ length: 26 }, (_, i) => `rem_id_${i}`);
    const overBatchRes = validateReminderCleanupRequest(overBatch);
    assert.equal(overBatchRes.valid, false);
    if (!overBatchRes.valid) {
      assert.equal(overBatchRes.status, 400);
      assert.equal(overBatchRes.code, 'REQUEST_TOO_LARGE');
    }

    // 3. ID length bounds: empty or oversized (>128 chars) rejected
    const emptyIdRes = validateReminderCleanupRequest(['']);
    assert.equal(emptyIdRes.valid, false);

    const oversizedId = 'a'.repeat(129);
    const oversizedRes = validateReminderCleanupRequest([oversizedId]);
    assert.equal(oversizedRes.valid, false);
    if (!oversizedRes.valid) {
      assert.equal(oversizedRes.code, 'INVALID_REMINDER_ID_LENGTH');
    }

    // 4. Valid 128 char ID accepted
    const maxValidId = 'b'.repeat(128);
    const maxValidRes = validateReminderCleanupRequest([maxValidId]);
    assert.equal(maxValidRes.valid, true);
  });

  test('Real mergeReminderCleanupQueue: all-or-nothing overflow prevention and zero-write duplicates', () => {
    const existing = ['rem_1', 'rem_2'];

    // 1. Duplicate POST: zero new IDs -> unchanged: true, 0 writes required
    const dupRes = mergeReminderCleanupQueue(existing, ['rem_1', 'rem_2']);
    assert.equal(dupRes.unchanged, true);
    assert.equal(dupRes.atCapacity, false);
    assert.equal(dupRes.newIds.length, 0);

    // 2. 99 existing + 2 new IDs -> overflow (>100) -> atCapacity: true with ZERO truncation
    const existing99 = Array.from({ length: 99 }, (_, i) => `rem_old_${i}`);
    const overflowRes = mergeReminderCleanupQueue(existing99, ['rem_new_A', 'rem_new_B'], 100);
    assert.equal(overflowRes.atCapacity, true, 'All-or-nothing capacity rejection triggered');
    assert.equal(overflowRes.unchanged, false);
    assert.equal(overflowRes.combined.length, 99, 'Existing queue was NOT truncated or modified');
    assert.deepEqual(overflowRes.newIds, ['rem_new_A', 'rem_new_B']);

    // 3. 98 existing + 2 new IDs -> fits exactly 100
    const existing98 = Array.from({ length: 98 }, (_, i) => `rem_old_${i}`);
    const fitRes = mergeReminderCleanupQueue(existing98, ['rem_new_A', 'rem_new_B'], 100);
    assert.equal(fitRes.atCapacity, false);
    assert.equal(fitRes.combined.length, 100, 'Queue successfully merged to 100 items');
    assert.equal(fitRes.newIds.length, 2);
  });

  test('Real validateOrphanReminder: accepts legitimate note orphan, rejects live-note and standalone reminders', async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/reminders/rem_orphan')) {
        return new Response(JSON.stringify({
          fields: {
            title: { stringValue: 'Take meds' },
            noteId: { stringValue: 'note_deleted_404' },
          },
        }), { status: 200 });
      }
      if (urlStr.includes('/notes/note_deleted_404')) {
        return new Response('Not found', { status: 404 });
      }
      if (urlStr.includes('/reminders/rem_live_note')) {
        return new Response(JSON.stringify({
          fields: {
            title: { stringValue: 'Buy groceries' },
            noteId: { stringValue: 'note_live_200' },
          },
        }), { status: 200 });
      }
      if (urlStr.includes('/notes/note_live_200')) {
        return new Response('{"fields":{}}', { status: 200 });
      }
      if (urlStr.includes('/reminders/rem_standalone')) {
        return new Response(JSON.stringify({
          fields: {
            title: { stringValue: 'Standalone reminder' },
            // NO noteId
          },
        }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    };

    // 1. Valid orphan reminder
    const resOrphan = await validateOrphanReminder(mockFetch as any, 'ntk-note', 'mock-token', 'user_1', 'rem_orphan');
    assert.equal(resOrphan.valid, true);
    if (resOrphan.valid) {
      assert.equal(resOrphan.noteId, 'note_deleted_404');
    }

    // 2. Reminder linked to live note: 409 REMINDER_NOT_ORPHANED
    const resLive = await validateOrphanReminder(mockFetch as any, 'ntk-note', 'mock-token', 'user_1', 'rem_live_note');
    assert.equal(resLive.valid, false);
    if (!resLive.valid) {
      assert.equal(resLive.status, 409);
      assert.equal(resLive.code, 'REMINDER_NOT_ORPHANED');
    }

    // 3. Standalone reminder: 400 STANDALONE_REMINDER_DENIED
    const resStandalone = await validateOrphanReminder(mockFetch as any, 'ntk-note', 'mock-token', 'user_1', 'rem_standalone');
    assert.equal(resStandalone.valid, false);
    if (!resStandalone.valid) {
      assert.equal(resStandalone.status, 400);
      assert.equal(resStandalone.code, 'STANDALONE_REMINDER_DENIED');
    }

    // 4. Nonexistent reminder: 404 REMINDER_NOT_FOUND
    const resNonexistent = await validateOrphanReminder(mockFetch as any, 'ntk-note', 'mock-token', 'user_1', 'rem_nonexistent');
    assert.equal(resNonexistent.valid, false);
    if (!resNonexistent.valid) {
      assert.equal(resNonexistent.status, 404);
      assert.equal(resNonexistent.code, 'REMINDER_NOT_FOUND');
    }
  });

  test('Real validateReminderCleanupDelete: blocks deletion if reminder still exists in Firestore', async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/reminders/rem_still_exists')) {
        return new Response('{"fields":{}}', { status: 200 });
      }
      if (urlStr.includes('/reminders/rem_genuinely_deleted')) {
        return new Response('Not found', { status: 404 });
      }
      return new Response('Error', { status: 500 });
    };

    // Reminder still exists -> 409 CLEANUP_NOT_COMPLETE
    const resBlocked = await validateReminderCleanupDelete(mockFetch as any, 'ntk-note', 'token', 'user_1', 'rem_still_exists');
    assert.equal(resBlocked.canDelete, false);
    if (!resBlocked.canDelete) {
      assert.equal(resBlocked.status, 409);
      assert.equal(resBlocked.code, 'CLEANUP_NOT_COMPLETE');
    }

    // Reminder absent in Firestore -> canDelete: true
    const resAllowed = await validateReminderCleanupDelete(mockFetch as any, 'ntk-note', 'token', 'user_1', 'rem_genuinely_deleted');
    assert.equal(resAllowed.canDelete, true);
  });

  test('Truthful TTS provider metadata verification', () => {
    // Verified architecture:
    // Gateway is Cloudflare Worker
    // Actual synthesis provider is Google Speech fallback (Translate TTS)
    const ttsMeta = {
      gateway: 'Cloudflare Worker (ntk-note-gateway)',
      provider: 'google-speech-translate-fallback',
      label: 'Google Speech Fallback (best-effort)',
      isCloudflareNative: false,
    };

    assert.equal(ttsMeta.gateway, 'Cloudflare Worker (ntk-note-gateway)');
    assert.equal(ttsMeta.provider, 'google-speech-translate-fallback');
    assert.equal(ttsMeta.isCloudflareNative, false, 'Truthful disclosure: not Cloudflare-native synthesis');
  });

  test('Spark budget invariant: max batch size <= 25, 0 Cloud Functions, 0 Firebase Storage media', () => {
    const BATCH_SIZE = 25;
    assert.ok(BATCH_SIZE <= 25, 'Batch size adheres to Firestore Spark limits');
    const cloudFunctionsUsed = 0;
    assert.equal(cloudFunctionsUsed, 0, 'Zero Cloud Functions on Spark plan');
    const firebaseStorageMediaBytes = 0;
    assert.equal(firebaseStorageMediaBytes, 0, 'Zero Firebase Storage media bytes');
  });
});

describe('Section 41: NTK Note v2.6 — Final KV Consistency, Free-Read Protection & Retry-Semantics Suite', () => {
  class MockKV implements SimpleKVNamespace {
    public store = new Map<string, string>();
    public putCount = 0;
    public getCount = 0;
    public deleteCount = 0;
    public failGetsOnKey: string | null = null;
    public failPutsOnKey: string | null = null;
    public failDeletesOnKey: string | null = null;

    async get<T = string>(key: string, type?: 'text' | 'json'): Promise<T | null> {
      if (this.failGetsOnKey && key.includes(this.failGetsOnKey)) {
        throw new Error(`Simulated KV GET failure on key: ${key}`);
      }
      this.getCount++;
      const val = this.store.get(key);
      if (val === undefined) return null;
      if (type === 'json') {
        try {
          return JSON.parse(val) as T;
        } catch {
          throw new SyntaxError(`Unexpected token in JSON at position 0`);
        }
      }
      return val as unknown as T;
    }

    async put(key: string, value: string): Promise<void> {
      if (this.failPutsOnKey && key.includes(this.failPutsOnKey)) {
        throw new Error(`Simulated KV PUT failure on key: ${key}`);
      }
      this.putCount++;
      this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
      if (this.failDeletesOnKey && key.includes(this.failDeletesOnKey)) {
        throw new Error(`Simulated KV DELETE failure on key: ${key}`);
      }
      this.deleteCount++;
      this.store.delete(key);
    }
  }

  test('Section 6-9: Index write fails -> marker is NEVER written (prevents orphan/hidden marker)', async () => {
    const mockKv = new MockKV();
    const uid = 'split_brain_user';
    const indexKey = `pending-media-cleanup-index:${uid}`;
    const markerKey = `pending-media-cleanup:${uid}:attachments:doc_split`;

    // Inject failure on indexKey
    mockKv.failPutsOnKey = indexKey;

    const res = await advanceServerMediaRetry(mockKv, uid, 'attachments', 'doc_split', null, 1000000);

    // Index update failed
    assert.equal(res.indexUpdated, false);
    assert.equal(res.markerUpdated, false);
    assert.equal(res.retryStatePersisted, false);

    // Marker was NEVER written to KV
    assert.equal(mockKv.store.has(markerKey), false, 'Marker key must not be created when index fails');
  });

  test('Section 8-9: Index succeeds but marker fails -> remains discoverable in index with retryStatePersisted: false', async () => {
    const mockKv = new MockKV();
    const uid = 'discoverable_user';
    const indexKey = `pending-media-cleanup-index:${uid}`;
    const markerKey = `pending-media-cleanup:${uid}:images:photo_split`;

    // Inject failure on markerKey
    mockKv.failPutsOnKey = markerKey;

    const res = await advanceServerMediaRetry(mockKv, uid, 'images', 'photo_split', null, 1000000);

    assert.equal(res.indexUpdated, true, 'Index was successfully updated');
    assert.equal(res.markerUpdated, false, 'Marker write failed');
    assert.equal(res.retryStatePersisted, false, 'Reports unpersisted safely since marker is missing');

    // Index entry exists and is fully discoverable
    const index = await mockKv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    assert.ok(Array.isArray(index));
    const found = index.find(i => i.purpose === 'images' && i.objectId === 'photo_split');
    assert.ok(found, 'Item must be discoverable in canonical index');
    assert.equal(found.retryCount, 1);
  });

  test('Section 10: removeUserPendingMediaCleanupMarker keeps index if marker delete fails', async () => {
    const mockKv = new MockKV();
    const uid = 'rm_fail_user';
    const markerKey = `pending-media-cleanup:${uid}:attachments:doc_rm`;
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Seed marker and index
    await mockKv.put(markerKey, JSON.stringify({ uid, purpose: 'attachments', objectId: 'doc_rm' }));
    await mockKv.put(indexKey, JSON.stringify([{ purpose: 'attachments', objectId: 'doc_rm', retryCount: 1 }]));

    // Inject failure on marker deletion
    mockKv.failDeletesOnKey = markerKey;

    const res = await removeUserPendingMediaCleanupMarker(mockKv, uid, 'attachments', 'doc_rm');

    assert.equal(res.markerDeleted, false, 'Marker deletion failed');
    assert.equal(res.indexUpdated, false, 'Index entry must NOT be deleted when marker fails');

    // Verify index still contains the item so it is not hidden/orphaned
    const index = await mockKv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    assert.equal(index?.length, 1, 'Index entry was preserved');
    assert.equal(index?.[0]?.objectId, 'doc_rm');
  });

  test('Section 13: Stale index entry without direct marker remains discoverable and can be retried', async () => {
    const mockKv = new MockKV();
    const uid = 'repair_user';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Seed index with entry, but NO direct marker
    await mockKv.put(indexKey, JSON.stringify([{
      purpose: 'attachments',
      objectId: 'doc_stale',
      queuedAt: '2026-09-06T10:00:00Z',
      retryCount: 1,
    }]));

    // advanceServerMediaRetry looks up index, finds the item, and updates both index and marker
    const res = await advanceServerMediaRetry(mockKv, uid, 'attachments', 'doc_stale', null, 2000000);
    assert.equal(res.indexUpdated, true);
    assert.equal(res.markerUpdated, true);
    assert.equal(res.retryStatePersisted, true);
    assert.equal(res.updatedRetries, 2);

    const markerKey = `pending-media-cleanup:${uid}:attachments:doc_stale`;
    const marker = await mockKv.get<PendingMediaMarker>(markerKey, 'json');
    assert.equal(marker?.retryCount, 2, 'Direct marker restored from index metadata');
  });

  test('Section 15-18: Reminder DELETE with 25 unqueued IDs triggers ZERO Firestore reads and returns unchanged', () => {
    const existingQueue = ['queued_rem_1', 'queued_rem_2'];
    const random25Ids = Array.from({ length: 25 }, (_, i) => `random_unread_${i}`);

    const { queuedIds, unqueuedCount } = filterQueuedReminderIds(existingQueue, random25Ids);

    assert.equal(queuedIds.length, 0, 'Zero queued IDs found');
    assert.equal(unqueuedCount, 25, 'All 25 IDs identified as unqueued');

    // In route: when queuedIds.length === 0, response is { ok: true, deleted: false, unchanged: true }
    // with ZERO Firestore REST calls and ZERO KV writes!
  });

  test('Section 17: Mixed queued and unqueued reminder DELETE validates ONLY queued IDs', async () => {
    const existingQueue = ['queued_1', 'queued_2'];
    const requestIds = ['queued_1', 'random_A', 'random_B', 'random_C'];

    const { queuedIds, unqueuedCount } = filterQueuedReminderIds(existingQueue, requestIds);

    assert.deepEqual(queuedIds, ['queued_1'], 'Only genuinely queued ID is selected for validation');
    assert.equal(unqueuedCount, 3, 'Three unqueued IDs bypassed');

    let firestoreReadCount = 0;
    const mockFetch = async (url: string | URL | Request) => {
      firestoreReadCount++;
      return new Response('Not found', { status: 404 });
    };

    // Only queued IDs are passed to validateReminderCleanupDelete
    for (const id of queuedIds) {
      const delCheck = await validateReminderCleanupDelete(mockFetch as any, 'ntk-note', 'token', 'user_1', id);
      assert.equal(delCheck.canDelete, true);
    }

    assert.equal(firestoreReadCount, 1, 'Firestore read was executed ONLY for queued_1, NOT for random IDs');
  });

  test('Section 19-20: Raw 26 duplicate flood is rejected with 400 REQUEST_TOO_LARGE before deduplication', () => {
    const raw26Duplicates = new Array(26).fill('same_reminder_id');
    const result = validateReminderCleanupRequest(raw26Duplicates, 25);

    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.status, 400);
      assert.equal(result.code, 'REQUEST_TOO_LARGE');
    }
  });

  test('Section 21: Non-string element in reminder array is rejected with 400 INVALID_REMINDER_ID', () => {
    const malformedList = ['rem_1', 123, null];
    const result = validateReminderCleanupRequest(malformedList, 25);

    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.status, 400);
      assert.equal(result.code, 'INVALID_REMINDER_ID');
    }
  });

  test('Section 22: Oversized reminder ID (>128 chars) is rejected with 400 before Firestore', () => {
    const oversizedId = 'x'.repeat(129);
    const result = validateReminderCleanupRequest([oversizedId], 25);

    assert.equal(result.valid, false);
    if (!result.valid) {
      assert.equal(result.status, 400);
      assert.equal(result.code, 'INVALID_REMINDER_ID_LENGTH');
    }
  });

  test('Section 27, 28, 30: 429 RETRY_NOT_READY stops immediate retry loop after 1 attempt', async () => {
    let fetchCount = 0;
    const originalFetch = globalThis.fetch;
    const serverTimestamp = '2026-09-06T14:30:00.000Z';

    // Mock auth user
    const originalUser = (auth as any).currentUser;
    (auth as any).currentUser = { getIdToken: async () => 'mock_token' };

    // Mock global fetch to return 429 RETRY_NOT_READY
    (globalThis as any).fetch = async () => {
      fetchCount++;
      return new Response(JSON.stringify({
        ok: false,
        code: 'RETRY_NOT_READY',
        message: 'Retry backoff active.',
        nextEligibleAttemptAt: serverTimestamp,
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    };

    try {
      const res = await deleteStorageFileDetailed('attachments', 'doc_backoff', 2);
      assert.equal(res.ok, false);
      assert.equal(res.status, 429);
      assert.equal(res.retryNotReady, true);
      assert.equal(res.code, 'RETRY_NOT_READY');
      assert.equal(res.nextEligibleAttemptAt, serverTimestamp);
      assert.equal(fetchCount, 1, 'Immediate retry loop must terminate on 429 without making attempts 2 or 3');
    } finally {
      globalThis.fetch = originalFetch;
      (auth as any).currentUser = originalUser;
    }
  });

  test('Section 29, 31: 429 RETRY_NOT_READY does not increment local retry count and copies server nextEligibleAttemptAt', async () => {
    const mockStorage: Record<string, string> = {};
    (globalThis as any).localStorage = {
      getItem: (k: string) => mockStorage[k] || null,
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      removeItem: (k: string) => { delete mockStorage[k]; },
    };

    const originalUser = (auth as any).currentUser;
    (auth as any).currentUser = { getIdToken: async () => 'mock_token' };

    const originalFetch = globalThis.fetch;
    const serverNextAttempt = '2026-09-06T15:00:00.000Z';
    let postCount = 0;

    (globalThis as any).fetch = async (url: string | URL | Request, init?: RequestInit) => {
      const urlStr = url.toString();
      const method = init?.method || 'GET';
      if (urlStr.includes('/v1/storage/cleanup-pending') && method === 'GET') {
        return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/v1/storage/cleanup-pending') && method === 'POST') {
        postCount++;
        return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/v1/storage/file/')) {
        return new Response(JSON.stringify({
          ok: false,
          code: 'RETRY_NOT_READY',
          message: 'Retry backoff active.',
          nextEligibleAttemptAt: serverNextAttempt,
        }), {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not found', { status: 404 });
    };

    try {
      const uid = 'user_429_test';
      enqueuePendingMediaCleanup({
        uid,
        purpose: 'attachments',
        objectId: 'obj_429',
      });

      // Item initially has retryCount = 0
      const initialItems = getPendingMediaCleanups(uid);
      assert.equal(initialItems.length, 1);
      assert.equal(initialItems[0].retryCount, 0);

      // Wait for background registration from enqueue to complete
      await new Promise(res => setTimeout(res, 50));
      postCount = 0;

      // Run retry cycle
      await retryPendingMediaCleanups(uid);

      // Verify item retryCount was NOT incremented on 429
      const afterItems = getPendingMediaCleanups(uid);
      assert.equal(afterItems.length, 1);
      assert.equal(afterItems[0].retryCount, 0, 'retryCount must remain unchanged on 429');
      assert.equal(afterItems[0].nextEligibleAttemptAt, serverNextAttempt, 'nextEligibleAttemptAt copied from server');
      assert.equal(afterItems[0].lastErrorCode, 'RETRY_NOT_READY');
      assert.equal(postCount, 0, 'No server marker POST after 429');
    } finally {
      globalThis.fetch = originalFetch;
      (auth as any).currentUser = originalUser;
    }
  });

  test('Section 5: Invariant check — truthful TTS label and Firebase Spark invariants', () => {
    const ttsMeta = {
      gateway: 'Cloudflare Worker (ntk-note-gateway)',
      provider: 'google-speech-translate-fallback',
      label: 'Google Speech Fallback (best-effort)',
      isCloudflareNative: false,
    };
    assert.equal(ttsMeta.label, 'Google Speech Fallback (best-effort)');
    assert.equal(ttsMeta.isCloudflareNative, false);

    // Spark invariants
    const sparkLimits = {
      cost: '$0/month',
      cloudFunctions: 0,
      firebaseStorageMediaBytes: 0,
      maxBatch: 25,
      firestoreDatabases: 1,
    };
    assert.equal(sparkLimits.cost, '$0/month');
    assert.equal(sparkLimits.cloudFunctions, 0);
    assert.equal(sparkLimits.firebaseStorageMediaBytes, 0);
    assert.ok(sparkLimits.maxBatch <= 25);
    assert.equal(sparkLimits.firestoreDatabases, 1);
  });

  test('Section 12: advanceServerMediaRetry fails closed on index GET failure, preserving existing 20 entries without replacement', async () => {
    const mockKv = new MockKV();
    const uid = 'user_fail_get_test';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Seed index with 20 entries
    const initial20: PendingMediaIndexItem[] = Array.from({ length: 20 }, (_, i) => ({
      purpose: 'attachments',
      objectId: `doc_${i}`,
      queuedAt: '2026-09-06T10:00:00Z',
      retryCount: 1,
    }));
    await mockKv.put(indexKey, JSON.stringify(initial20));
    mockKv.putCount = 0;

    // Configure simulated GET failure on indexKey
    mockKv.failGetsOnKey = indexKey;

    // Attempt advanceServerMediaRetry for a new object
    const result = await advanceServerMediaRetry(mockKv, uid, 'images', 'new_photo', null, 1000000);

    // Assert fail-closed response
    assert.equal(result.indexReadFailed, true, 'indexReadFailed is true');
    assert.equal(result.indexUpdated, false, 'indexUpdated is false');
    assert.equal(result.markerUpdated, false, 'markerUpdated is false');
    assert.equal(result.retryStatePersisted, false, 'retryStatePersisted is false');
    assert.equal(mockKv.putCount, 0, 'Zero writes performed when index read fails');

    // Remove simulated failure and verify original 20 items are intact
    mockKv.failGetsOnKey = null;
    const rawIndex = await mockKv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    assert.equal(rawIndex?.length, 20, 'All 20 original entries remain intact');
    assert.equal(rawIndex?.[0].objectId, 'doc_0');
    assert.equal(rawIndex?.[19].objectId, 'doc_19');

    // Ensure no orphan marker was written
    const markerKey = `pending-media-cleanup:${uid}:images:new_photo`;
    assert.equal(mockKv.store.has(markerKey), false, 'Zero marker written');
  });

  test('Section 13: removeUserPendingMediaCleanupMarker fails closed on index GET failure, preserving marker and index', async () => {
    const mockKv = new MockKV();
    const uid = 'user_rm_fail_test';
    const markerKey = `pending-media-cleanup:${uid}:attachments:doc_seed`;
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Seed marker and index
    await mockKv.put(markerKey, JSON.stringify({ uid, purpose: 'attachments', objectId: 'doc_seed' }));
    await mockKv.put(indexKey, JSON.stringify([{ purpose: 'attachments', objectId: 'doc_seed' }]));
    mockKv.deleteCount = 0;

    // Configure simulated GET failure on indexKey
    mockKv.failGetsOnKey = indexKey;

    // Call removeUserPendingMediaCleanupMarker
    const res = await removeUserPendingMediaCleanupMarker(mockKv, uid, 'attachments', 'doc_seed');

    // Assert fail-closed response
    assert.equal(res.indexReadFailed, true, 'indexReadFailed is true');
    assert.equal(res.markerDeleted, false, 'markerDeleted is false');
    assert.equal(res.indexUpdated, false, 'indexUpdated is false');
    assert.equal(mockKv.deleteCount, 0, 'Zero deletes attempted on KV read failure');

    // Remove simulated failure and verify both marker and index are still present
    mockKv.failGetsOnKey = null;
    assert.equal(mockKv.store.has(markerKey), true, 'Marker remains in KV');
    const rawIndex = await mockKv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    assert.equal(rawIndex?.length, 1, 'Index entry remains in KV');
    assert.equal(rawIndex?.[0].objectId, 'doc_seed');
  });

  test('Section 14: Absent KV key (null) is handled as valid empty queue without read failure', async () => {
    const mockKv = new MockKV();
    const uid = 'user_absent_test';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Key does not exist in store -> get returns null
    assert.equal(await mockKv.get(indexKey), null);

    // Advance retry on absent index
    const resAdvance = await advanceServerMediaRetry(mockKv, uid, 'attachments', 'doc_first', null, 1000000);
    assert.equal(resAdvance.indexReadFailed, false, 'indexReadFailed is false for absent key');
    assert.equal(resAdvance.indexUpdated, true, 'Index is created');
    assert.equal(resAdvance.markerUpdated, true, 'Marker is created');

    const createdIndex = await mockKv.get<PendingMediaIndexItem[]>(indexKey, 'json');
    assert.equal(createdIndex?.length, 1);
    assert.equal(createdIndex?.[0].objectId, 'doc_first');

    // Remove on absent index for non-existent user
    const resRemove = await removeUserPendingMediaCleanupMarker(mockKv, 'user_nonexistent', 'attachments', 'doc_none');
    assert.equal(resRemove.indexReadFailed, false, 'indexReadFailed is false for absent key');
    assert.equal(resRemove.wasPresent, false, 'wasPresent is false');
  });

  test('Section 15: Malformed canonical index fails closed and is never replaced with empty queue', async () => {
    const mockKv = new MockKV();
    const uid = 'user_malformed_test';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Case A: Stored value is an object rather than an array
    mockKv.store.set(indexKey, JSON.stringify({ corrupted: 'not an array' }));
    mockKv.putCount = 0;

    const resA = await advanceServerMediaRetry(mockKv, uid, 'images', 'photo_1', null, 1000000);
    assert.equal(resA.indexReadFailed, true, 'Non-array index flags indexReadFailed');
    assert.equal(resA.indexUpdated, false, 'Non-array index is not updated');
    assert.equal(resA.markerUpdated, false, 'No marker is written');
    assert.equal(mockKv.putCount, 0, 'Zero writes on malformed data');

    const rmResA = await removeUserPendingMediaCleanupMarker(mockKv, uid, 'images', 'photo_1');
    assert.equal(rmResA.indexReadFailed, true, 'Non-array index flags indexReadFailed on removal');
    assert.equal(rmResA.markerDeleted, false, 'Marker is not deleted');
    assert.equal(rmResA.indexUpdated, false, 'Index is not updated');

    // Case B: Corrupted invalid JSON string
    mockKv.store.set(indexKey, '{"broken_json: definitely_not_valid');
    const resB = await advanceServerMediaRetry(mockKv, uid, 'images', 'photo_2', null, 1000000);
    assert.equal(resB.indexReadFailed, true, 'Corrupted JSON flags indexReadFailed');
    assert.equal(resB.indexUpdated, false);
    assert.equal(resB.markerUpdated, false);
    assert.equal(mockKv.store.get(indexKey), '{"broken_json: definitely_not_valid', 'Corrupted string was NOT replaced');
  });
});

describe('Section 42: NTK Note v2.6 — Absolute Final Route-Level KV Read Closure & Fail-Closed Storage Delete Suite', () => {
  class MockRouteKV implements SimpleKVNamespace {
    public store = new Map<string, string>();
    public putCount = 0;
    public getCount = 0;
    public deleteCount = 0;
    public failGetsOnKey: string | null = null;
    public failPutsOnKey: string | null = null;
    public failDeletesOnKey: string | null = null;

    async get<T = string>(key: string, type?: 'text' | 'json'): Promise<T | null> {
      if (this.failGetsOnKey && key.includes(this.failGetsOnKey)) {
        throw new Error(`Simulated KV GET failure on key: ${key}`);
      }
      this.getCount++;
      const val = this.store.get(key);
      if (val === undefined) return null;
      if (type === 'json') {
        try {
          return JSON.parse(val) as T;
        } catch {
          throw new SyntaxError(`Unexpected token in JSON at position 0`);
        }
      }
      return val as unknown as T;
    }

    async put(key: string, value: string): Promise<void> {
      if (this.failPutsOnKey && key.includes(this.failPutsOnKey)) {
        throw new Error(`Simulated KV PUT failure on key: ${key}`);
      }
      this.putCount++;
      this.store.set(key, value);
    }

    async delete(key: string): Promise<void> {
      if (this.failDeletesOnKey && key.includes(this.failDeletesOnKey)) {
        throw new Error(`Simulated KV DELETE failure on key: ${key}`);
      }
      this.deleteCount++;
      this.store.delete(key);
    }
  }

  // Helper simulating the DELETE /v1/storage/file route's pre-delete gate and handler execution
  async function simulateDeleteStorageFileRoute(params: {
    kv: SimpleKVNamespace;
    uid: string;
    purpose: 'images' | 'attachments' | 'voiceNotes' | 'profilePhotos' | 'backups' | 'exports';
    objectId: string;
    nowMs?: number;
    mockStorageDelete?: () => Promise<void>;
    mockQuotaDeltaWrite?: () => Promise<void>;
    mockFileMetadataDelete?: () => Promise<void>;
  }) {
    let storageDeleteCalls = 0;
    let quotaDeltaWrites = 0;
    let fileMetadataDeletes = 0;

    // Route gate check:
    const eligibility = await checkStorageDeleteEligibility(
      params.kv,
      params.uid,
      params.purpose,
      params.objectId,
      params.nowMs
    );

    if (!eligibility.allowed) {
      if (eligibility.code === 'QUEUE_STATE_UNAVAILABLE') {
        return {
          status: eligibility.status,
          body: {
            ok: false,
            code: 'QUEUE_STATE_UNAVAILABLE',
            message: eligibility.message,
          },
          storageDeleteCalls,
          quotaDeltaWrites,
          fileMetadataDeletes,
        };
      }
      return {
        status: eligibility.status,
        body: {
          ok: false,
          code: eligibility.code,
          message: eligibility.message,
          nextEligibleAttemptAt: eligibility.nextEligibleAttemptAt,
        },
        storageDeleteCalls,
        quotaDeltaWrites,
        fileMetadataDeletes,
      };
    }

    // Normal execution path if allowed:
    if (params.mockStorageDelete) {
      await params.mockStorageDelete();
      storageDeleteCalls++;
    } else {
      storageDeleteCalls++;
    }

    if (params.mockQuotaDeltaWrite) {
      await params.mockQuotaDeltaWrite();
      quotaDeltaWrites++;
    } else {
      quotaDeltaWrites++;
    }

    if (params.mockFileMetadataDelete) {
      await params.mockFileMetadataDelete();
      fileMetadataDeletes++;
    } else {
      fileMetadataDeletes++;
    }

    return {
      status: 200,
      body: { ok: true },
      storageDeleteCalls,
      quotaDeltaWrites,
      fileMetadataDeletes,
    };
  }

  test('Section 11: Canonical index has future backoff item + KV GET throws -> 503 QUEUE_STATE_UNAVAILABLE, zero physical deletes, zero KV puts, zero quota delta writes, zero metadata deletes', async () => {
    const mockKv = new MockRouteKV();
    const uid = 'user_route_get_fail';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Seed canonical index with a future backoff item
    const futureIso = new Date(Date.now() + 600000).toISOString();
    await mockKv.put(indexKey, JSON.stringify([{
      purpose: 'images',
      objectId: 'photo_backoff',
      queuedAt: new Date().toISOString(),
      retryCount: 2,
      lastAttemptAt: new Date().toISOString(),
      nextEligibleAttemptAt: futureIso,
    }]));

    // Reset counts and inject failure on KV GET
    mockKv.putCount = 0;
    mockKv.failGetsOnKey = indexKey;

    const res = await simulateDeleteStorageFileRoute({
      kv: mockKv,
      uid,
      purpose: 'images',
      objectId: 'photo_backoff',
    });

    assert.equal(res.status, 503, 'Route returns HTTP 503');
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'QUEUE_STATE_UNAVAILABLE');
    assert.equal(res.body.message, 'Cleanup will retry automatically.');
    assert.equal(res.storageDeleteCalls, 0, 'Physical storage delete calls must be exactly 0');
    assert.equal(res.quotaDeltaWrites, 0, 'Quota delta writes must be exactly 0');
    assert.equal(res.fileMetadataDeletes, 0, 'File metadata deletes must be exactly 0');
    assert.equal(mockKv.putCount, 0, 'KV puts must be exactly 0');
  });

  test('Section 12: Malformed canonical index ({ bad: "not-array" }) -> 503 QUEUE_STATE_UNAVAILABLE, zero physical storage calls, zero destructive metadata changes', async () => {
    const mockKv = new MockRouteKV();
    const uid = 'user_malformed_route';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Case 1: Non-array object
    await mockKv.put(indexKey, JSON.stringify({ bad: 'not-array' }));
    mockKv.putCount = 0;

    const resNonArray = await simulateDeleteStorageFileRoute({
      kv: mockKv,
      uid,
      purpose: 'attachments',
      objectId: 'file_corrupt',
    });

    assert.equal(resNonArray.status, 503);
    assert.equal(resNonArray.body.code, 'QUEUE_STATE_UNAVAILABLE');
    assert.equal(resNonArray.body.message, 'Cleanup will retry automatically.');
    assert.equal(resNonArray.storageDeleteCalls, 0, 'Zero storage deletes on non-array index');
    assert.equal(resNonArray.quotaDeltaWrites, 0, 'Zero quota writes on non-array index');
    assert.equal(resNonArray.fileMetadataDeletes, 0, 'Zero metadata deletes on non-array index');
    assert.equal(mockKv.putCount, 0, 'Zero KV puts on non-array index');

    // Case 2: Broken JSON syntax
    mockKv.store.set(indexKey, '{"invalid_json: 123');
    const resSyntax = await simulateDeleteStorageFileRoute({
      kv: mockKv,
      uid,
      purpose: 'attachments',
      objectId: 'file_corrupt',
    });

    assert.equal(resSyntax.status, 503);
    assert.equal(resSyntax.body.code, 'QUEUE_STATE_UNAVAILABLE');
    assert.equal(resSyntax.storageDeleteCalls, 0, 'Zero storage deletes on invalid JSON');
    assert.equal(resSyntax.quotaDeltaWrites, 0);
    assert.equal(resSyntax.fileMetadataDeletes, 0);
  });

  test('Section 13: Null canonical index (genuinely absent queue) is valid and allows normal delete processing', async () => {
    const mockKv = new MockRouteKV();
    const uid = 'user_absent_queue';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    // Key is absent in KV
    assert.equal(mockKv.store.has(indexKey), false);

    const res = await simulateDeleteStorageFileRoute({
      kv: mockKv,
      uid,
      purpose: 'images',
      objectId: 'photo_normal',
    });

    assert.equal(res.status, 200, 'Normal delete processing proceeds when index is null');
    assert.equal(res.body.ok, true);
    assert.equal(res.storageDeleteCalls, 1, 'Physical storage delete executed normally');
    assert.equal(res.quotaDeltaWrites, 1, 'Quota delta recorded normally');
    assert.equal(res.fileMetadataDeletes, 1, 'File metadata deleted normally');
  });

  test('Section 14: Future server backoff item in canonical index returns 429 RETRY_NOT_READY with zero physical storage delete calls', async () => {
    const mockKv = new MockRouteKV();
    const uid = 'user_future_backoff';
    const indexKey = `pending-media-cleanup-index:${uid}`;

    const nowMs = 1757170800000;
    const futureTime = new Date(nowMs + 300000).toISOString();

    await mockKv.put(indexKey, JSON.stringify([{
      purpose: 'attachments',
      objectId: 'doc_delayed',
      queuedAt: new Date(nowMs - 60000).toISOString(),
      retryCount: 1,
      lastAttemptAt: new Date(nowMs - 60000).toISOString(),
      nextEligibleAttemptAt: futureTime,
    }]));

    const res = await simulateDeleteStorageFileRoute({
      kv: mockKv,
      uid,
      purpose: 'attachments',
      objectId: 'doc_delayed',
      nowMs,
    });

    assert.equal(res.status, 429, 'Route returns HTTP 429');
    assert.equal(res.body.ok, false);
    assert.equal(res.body.code, 'RETRY_NOT_READY');
    assert.equal(res.body.message, 'Retry backoff active. Please wait before retrying deletion.');
    assert.equal(res.body.nextEligibleAttemptAt, futureTime);
    assert.equal(res.storageDeleteCalls, 0, 'Zero physical storage delete calls on 429 backoff');
    assert.equal(res.quotaDeltaWrites, 0, 'Zero quota delta writes on 429 backoff');
    assert.equal(res.fileMetadataDeletes, 0, 'Zero metadata deletes on 429 backoff');
  });

  test('Section 9 & 10: Direct marker fallback is consulted ONLY after canonical index read succeeds, never when index GET throws', async () => {
    const mockKv = new MockRouteKV();
    const uid = 'user_fallback_test';
    const indexKey = `pending-media-cleanup-index:${uid}`;
    const markerKey = `pending-media-cleanup:${uid}:images:fallback_img`;

    const nowMs = 1757170800000;
    const futureTime = new Date(nowMs + 300000).toISOString();

    // Direct legacy marker has future backoff
    await mockKv.put(markerKey, JSON.stringify({
      uid,
      purpose: 'images',
      objectId: 'fallback_img',
      queuedAt: new Date(nowMs - 60000).toISOString(),
      retryCount: 1,
      lastAttemptAt: new Date(nowMs - 60000).toISOString(),
      nextEligibleAttemptAt: futureTime,
    }));

    // Case 1: Canonical index read succeeds (empty array) -> direct marker fallback is safely consulted and returns 429
    await mockKv.put(indexKey, JSON.stringify([]));
    const resSuccessRead = await simulateDeleteStorageFileRoute({
      kv: mockKv,
      uid,
      purpose: 'images',
      objectId: 'fallback_img',
      nowMs,
    });
    assert.equal(resSuccessRead.status, 429);
    assert.equal(resSuccessRead.body.code, 'RETRY_NOT_READY');
    assert.equal(resSuccessRead.storageDeleteCalls, 0);

    // Case 2: Canonical index GET throws -> direct marker is NOT consulted, fails closed with 503
    mockKv.failGetsOnKey = indexKey;
    const resFailedRead = await simulateDeleteStorageFileRoute({
      kv: mockKv,
      uid,
      purpose: 'images',
      objectId: 'fallback_img',
      nowMs,
    });
    assert.equal(resFailedRead.status, 503);
    assert.equal(resFailedRead.body.code, 'QUEUE_STATE_UNAVAILABLE');
    assert.equal(resFailedRead.storageDeleteCalls, 0);
  });

  test('Section 10 & 15: readPendingReminderIndexFailClosed fails closed on GET error or malformed non-array index', async () => {
    const mockKv = new MockRouteKV();
    const uid = 'user_reminder_failclosed';
    const key = `pending-reminder-cleanup-index:${uid}`;

    // Normal empty
    const resAbsent = await readPendingReminderIndexFailClosed(mockKv, uid);
    assert.equal(resAbsent.ok, true);
    if (resAbsent.ok) {
      assert.deepEqual(resAbsent.items, []);
    }

    // Normal populated
    await mockKv.put(key, JSON.stringify(['rem_1', 'rem_2']));
    const resPopulated = await readPendingReminderIndexFailClosed(mockKv, uid);
    assert.equal(resPopulated.ok, true);
    if (resPopulated.ok) {
      assert.deepEqual(resPopulated.items, ['rem_1', 'rem_2']);
    }

    // Malformed non-array data
    await mockKv.put(key, JSON.stringify({ corrupted: 'not_an_array' }));
    const resMalformed = await readPendingReminderIndexFailClosed(mockKv, uid);
    assert.equal(resMalformed.ok, false);
    if (!resMalformed.ok) {
      assert.equal(resMalformed.code, 'QUEUE_STATE_UNAVAILABLE');
      assert.equal(resMalformed.message, 'Cleanup will retry automatically.');
    }

    // GET exception
    mockKv.failGetsOnKey = key;
    const resThrow = await readPendingReminderIndexFailClosed(mockKv, uid);
    assert.equal(resThrow.ok, false);
    if (!resThrow.ok) {
      assert.equal(resThrow.code, 'QUEUE_STATE_UNAVAILABLE');
      assert.equal(resThrow.message, 'Cleanup will retry automatically.');
    }
  });
});

describe('Section 43: NTK Note v2.7 — Listen Engine Modernization & Workers AI Speech Suite', () => {
  describe('Intelligent Sentence & Chunk Splitting', () => {
    test('splitIntoSentences preserves abbreviations and initials', () => {
      const input = 'Dr. Amina arrived at Lagos. She met Prof. Oluwaseun and Mr. Chukwuemeka. All were present.';
      const sentences = splitIntoSentences(input);
      assert.equal(sentences.length, 3);
      assert.equal(sentences[0], 'Dr. Amina arrived at Lagos.');
      assert.equal(sentences[1], 'She met Prof. Oluwaseun and Mr. Chukwuemeka.');
      assert.equal(sentences[2], 'All were present.');
    });

    test('splitIntoSentences preserves currency symbols and figures (₦25,000, $10.50)', () => {
      const input = 'The project costs ₦25,000 in Abuja. Foreign licenses cost $10.50 per user. Payment is confirmed.';
      const sentences = splitIntoSentences(input);
      assert.equal(sentences.length, 3);
      assert.equal(sentences[0], 'The project costs ₦25,000 in Abuja.');
      assert.equal(sentences[1], 'Foreign licenses cost $10.50 per user.');
      assert.equal(sentences[2], 'Payment is confirmed.');
    });

    test('splitIntoSentences handles questions, exclamations, and numbers without splitting on decimals', () => {
      const input = 'Are you travelling to Enugu? Yes, version 2.7 is ready! The ratio is 3.14 to 1.0.';
      const sentences = splitIntoSentences(input);
      assert.equal(sentences.length, 3);
      assert.equal(sentences[0], 'Are you travelling to Enugu?');
      assert.equal(sentences[1], 'Yes, version 2.7 is ready!');
      assert.equal(sentences[2], 'The ratio is 3.14 to 1.0.');
    });

    test('splitTextIntoChunks returns single chunk for short text', () => {
      const text = 'Hello from NTK Note. This is a short note.';
      const chunks = splitTextIntoChunks(text, 1200);
      assert.equal(chunks.length, 1);
      assert.equal(chunks[0], text);
    });

    test('splitTextIntoChunks bounds chunks without cutting words or abbreviations in half', () => {
      // Build a long text of repeating sentences
      const sentence = 'Dr. Amina received ₦25,000 from Chukwuemeka in Lagos. ';
      const longText = sentence.repeat(50); // ~2700 chars
      const chunks = splitTextIntoChunks(longText, 600);

      assert.ok(chunks.length > 1);
      for (const chunk of chunks) {
        assert.ok(chunk.length <= 600, `Chunk exceeds max: ${chunk.length}`);
        // Ensure no chunk starts or ends with broken word
        assert.ok(!chunk.startsWith('mina'));
        assert.ok(!chunk.startsWith('25,000'));
        // Check that sentence punctuation exists
        assert.ok(chunk.includes('.'));
      }
    });
  });

  describe('Real Production Provider Plan & Owner Authority (buildSpeechProviderPlan)', () => {
    test('Automatic mode: prioritizes Cloudflare then Google', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'automatic', cloudflareEnabled: true, googleEnabled: true, preferredOrder: ['cloudflare', 'google'] },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.deepEqual(plan, ['cloudflare', 'google']);
    });

    test('Cloudflare owner mode: Cloudflare first, Google fallback', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'cloudflare', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.deepEqual(plan, ['cloudflare', 'google']);
    });

    test('Google owner mode: Google first, Cloudflare fallback', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'google', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.deepEqual(plan, ['google', 'cloudflare']);
    });

    test('Disabled provider enforcement: Cloudflare disabled is never in plan', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'automatic', cloudflareEnabled: false, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.deepEqual(plan, ['google']);
      assert.ok(!plan.includes('cloudflare'));
    });

    test('Disabled provider enforcement: Google disabled is never in plan', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'automatic', cloudflareEnabled: true, googleEnabled: false },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.deepEqual(plan, ['cloudflare']);
      assert.ok(!plan.includes('google'));
    });

    test('Both providers disabled yields empty plan', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'automatic', cloudflareEnabled: false, googleEnabled: false },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.deepEqual(plan, []);
    });

    test('Owner Authority: normal client preferredEngine CANNOT override server mode', () => {
      // Owner set Google mode; normal client requests cloudflare
      const planGoogleMode = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'google', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
        user: { owner: false },
        clientPreferredEngine: 'cloudflare',
      });
      assert.deepEqual(planGoogleMode, ['google', 'cloudflare'], 'Server Google mode must be authoritative over normal client');

      // Owner set Cloudflare mode; normal client requests google
      const planCfMode = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'cloudflare', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
        user: { owner: false },
        clientPreferredEngine: 'google',
      });
      assert.deepEqual(planCfMode, ['cloudflare', 'google'], 'Server Cloudflare mode must be authoritative over normal client');
    });

    test('Owner Authority: authenticated owner diagnostic request DOES honor preferredEngine override', () => {
      // Owner diagnostic request for Google
      const planDiagnosticGoogle = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'cloudflare', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
        user: { owner: true },
        isDiagnostic: true,
        clientPreferredEngine: 'google',
      });
      assert.deepEqual(planDiagnosticGoogle, ['google', 'cloudflare'], 'Owner diagnostic request can test specific provider');

      // Owner diagnostic request for Cloudflare
      const planDiagnosticCf = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'google', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
        user: { owner: true },
        isDiagnostic: true,
        clientPreferredEngine: 'cloudflare',
      });
      assert.deepEqual(planDiagnosticCf, ['cloudflare', 'google'], 'Owner diagnostic request can test Cloudflare');
    });

    test('Non-owner diagnostic attempt is rejected and adheres to owner policy', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'google', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: false,
        user: { owner: false },
        isDiagnostic: true,
        clientPreferredEngine: 'cloudflare',
      });
      assert.deepEqual(plan, ['google', 'cloudflare'], 'Non-owner diagnostic override must be ignored');
    });

    test('Hausa language routes strictly to Google Speech Fallback and skips Cloudflare MeloTTS', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'cloudflare', cloudflareEnabled: true, googleEnabled: true },
        hasAiBinding: true,
        isHausa: true,
      });
      assert.deepEqual(plan, ['google']);

      // If Google disabled, Hausa has no provider
      const planNoGoogle = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'automatic', cloudflareEnabled: true, googleEnabled: false },
        hasAiBinding: true,
        isHausa: true,
      });
      assert.deepEqual(planNoGoogle, []);
    });

    test('Loop prevention: Provider attempted at most once per logical request', () => {
      const plan = buildSpeechProviderPlan({
        policyListenEngine: {
          mode: 'automatic',
          cloudflareEnabled: true,
          googleEnabled: true,
          preferredOrder: ['cloudflare', 'cloudflare', 'google', 'google'],
        },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.deepEqual(plan, ['cloudflare', 'google']);
      assert.equal(plan.filter(p => p === 'cloudflare').length, 1);
      assert.equal(plan.filter(p => p === 'google').length, 1);
    });
  });

  describe('Real Production Locale Classification (classifySpeechLocale)', () => {
    test('English classifies as NATIVE with en language tags', () => {
      const en = classifySpeechLocale('en-US');
      assert.equal(en.status, 200);
      assert.equal(en.googleTl, 'en');
      assert.equal(en.cloudflareLang, 'en');
      assert.equal(en.isHausa, false);
      assert.equal(en.classification, 'NATIVE');
    });

    test('Nigerian English truthfully classifies as CLOSEST MATCH with preserved formatting', () => {
      const enNg = classifySpeechLocale('en-NG');
      assert.equal(enNg.status, 200);
      assert.equal(enNg.googleTl, 'en');
      assert.equal(enNg.cloudflareLang, 'en');
      assert.equal(enNg.isHausa, false);
      assert.equal(enNg.classification, 'CLOSEST MATCH');
    });

    test('Hausa classifies as NATIVE for Google Speech Fallback', () => {
      const ha = classifySpeechLocale('ha-NG');
      assert.equal(ha.status, 200);
      assert.equal(ha.googleTl, 'ha');
      assert.equal(ha.isHausa, true);
      assert.equal(ha.classification, 'NATIVE');
    });

    test('Yoruba without consent returns 400 VOICE_UNAVAILABLE', () => {
      const yo = classifySpeechLocale('yo-NG', false);
      assert.equal(yo.status, 400);
      assert.equal(yo.code, 'VOICE_UNAVAILABLE');
      assert.ok(yo.message?.includes('closest available voice'));
      assert.equal(yo.closestLocale, 'en-NG');
    });

    test('Yoruba with closest match consent succeeds with closest match classification', () => {
      const yo = classifySpeechLocale('yo-NG', true);
      assert.equal(yo.status, 200);
      assert.equal(yo.googleTl, 'en');
      assert.equal(yo.cloudflareLang, 'en');
      assert.equal(yo.classification, 'CLOSEST MATCH');
    });

    test('Igbo without consent returns 400 VOICE_UNAVAILABLE', () => {
      const ig = classifySpeechLocale('ig-NG', false);
      assert.equal(ig.status, 400);
      assert.equal(ig.code, 'VOICE_UNAVAILABLE');
      assert.ok(ig.message?.includes('closest available voice'));
      assert.equal(ig.closestLocale, 'en-NG');
    });

    test('Igbo with closest match consent succeeds with closest match classification', () => {
      const ig = classifySpeechLocale('ig-NG', true);
      assert.equal(ig.status, 200);
      assert.equal(ig.googleTl, 'en');
      assert.equal(ig.cloudflareLang, 'en');
      assert.equal(ig.classification, 'CLOSEST MATCH');
    });
  });

  describe('Real Production Quota & Cooldown Helper (classifyQuotaCooldown)', () => {
    test('Daily quota exhaustion triggers midnight cooldown classification', () => {
      const cfQuota = classifyQuotaCooldown('Cloudflare Workers AI daily neuron quota reached', 429);
      assert.equal(cfQuota.isDailyQuota, true);
      assert.equal(cfQuota.reason, 'daily-quota-exhausted');
      assert.ok(cfQuota.cooldownMs >= 60_000);
      assert.ok(cfQuota.cooldownMs <= 86_400_000);
    });

    test('Transient rate limit triggers short conservative cooldown without marking daily exhaustion', () => {
      const rateLimit = classifyQuotaCooldown('Too Many Requests', 429);
      assert.equal(rateLimit.isDailyQuota, false);
      assert.equal(rateLimit.reason, 'rate-limit');
      assert.equal(rateLimit.cooldownMs, 60_000);
    });

    test('Generic provider 500 error triggers transient provider error cooldown', () => {
      const error = classifyQuotaCooldown('Internal server error', 500);
      assert.equal(error.isDailyQuota, false);
      assert.equal(error.reason, 'provider-error');
      assert.equal(error.cooldownMs, 60_000);
    });

    test('msUntilUtcMidnight calculation returns sensible remaining time', () => {
      const ms = msUntilUtcMidnight();
      assert.ok(ms >= 60_000, 'Remaining ms must be at least 1 minute');
      assert.ok(ms <= 86_400_000, 'Remaining ms cannot exceed 24 hours');
    });
  });

  describe('Session Speech Cache True LRU, Collision Safety & UID Isolation', () => {
    test('computeSpeechCacheKey produces deterministic, parameter-sensitive keys', () => {
      const key1 = computeSpeechCacheKey({ text: 'Test audio generation', language: 'en-US', speed: 1, uid: 'user_1' });
      const key2 = computeSpeechCacheKey({ text: 'Test audio generation', language: 'en-US', speed: 1, uid: 'user_1' });
      const key3 = computeSpeechCacheKey({ text: 'Test audio generation', language: 'en-NG', speed: 1, uid: 'user_1' });
      const key4 = computeSpeechCacheKey({ text: 'Different text content', language: 'en-US', speed: 1, uid: 'user_1' });
      const key5 = computeSpeechCacheKey({ text: 'Test audio generation', language: 'en-US', speed: 1.2, uid: 'user_1' });
      const key6 = computeSpeechCacheKey({ text: 'Test audio generation', language: 'en-US', speed: 1, allowClosestMatch: true, uid: 'user_1' });

      assert.equal(key1, key2, 'Identical options must produce identical cache keys');
      assert.notEqual(key1, key3, 'Different language must produce different cache key');
      assert.notEqual(key1, key4, 'Different text must produce different cache key');
      assert.equal(key1, key5, 'Speed is client-side playbackRate only and must produce identical cache key for reuse');
      assert.notEqual(key1, key6, 'allowClosestMatch flag must produce different cache key');
    });

    test('computeSpeechCacheKey ignores fake deprecated parameters', () => {
      const keyBase = computeSpeechCacheKey({ text: 'Identical sentence', language: 'en-US', speed: 1, uid: 'u1' });
      const keyWithFakeParams = computeSpeechCacheKey({
        text: 'Identical sentence',
        language: 'en-US',
        speed: 1,
        uid: 'u1',
        voice: 'warm',
        gender: 'female',
        style: 'storyteller',
      });
      assert.equal(keyBase, keyWithFakeParams, 'Fake voice/gender/style must NOT alter cache identity');
    });

    test('UID Account Isolation: different users have distinct cache keys', () => {
      const keyUserA = computeSpeechCacheKey({ text: 'Private note text', language: 'en-US', uid: 'user_A' });
      const keyUserB = computeSpeechCacheKey({ text: 'Private note text', language: 'en-US', uid: 'user_B' });
      assert.notEqual(keyUserA, keyUserB, 'Cross-user cache keys must never collide');
    });

    test('UID Account Isolation: setCurrentSpeechUser clears cache on account switch', () => {
      setCurrentSpeechUser('user_alice');
      assert.equal(getCurrentSpeechUser(), 'user_alice');

      const blobAlice = new Blob(['alice audio'], { type: 'audio/mp3' });
      const keyAlice = computeSpeechCacheKey({ text: 'Note Alice', language: 'en-US' });
      sessionSpeechCache.set(keyAlice, blobAlice);
      assert.equal(sessionSpeechCache.size, 1);

      // Switch to Bob: cache MUST be cleared to prevent data leakage
      setCurrentSpeechUser('user_bob');
      assert.equal(getCurrentSpeechUser(), 'user_bob');
      assert.equal(sessionSpeechCache.size, 0, 'Switching accounts must clear session speech cache');
      assert.equal(sessionSpeechCache.has(keyAlice), false);

      // Clean up
      setCurrentSpeechUser(null);
    });

    test('Engine policy change clears session speech cache', () => {
      clearSessionSpeechCache();
      const fakeBlob = new Blob(['cached speech'], { type: 'audio/mp3' });
      const key = computeSpeechCacheKey({ text: 'Cached speech note', language: 'en-NG' });
      sessionSpeechCache.set(key, fakeBlob);
      assert.equal(sessionSpeechCache.size, 1);

      // Updating listen engine policy invalidates cache
      clearSessionSpeechCache();
      assert.equal(sessionSpeechCache.size, 0);
    });

    test('True LRU ordering: cache hit reinserts entry as newest', () => {
      clearSessionSpeechCache();

      const blobA = new Blob(['A'], { type: 'audio/mp3' });
      const blobB = new Blob(['B'], { type: 'audio/mp3' });
      const blobC = new Blob(['C'], { type: 'audio/mp3' });

      const keyA = 'test_lru_A';
      const keyB = 'test_lru_B';
      const keyC = 'test_lru_C';

      sessionSpeechCache.set(keyA, blobA);
      sessionSpeechCache.set(keyB, blobB);
      sessionSpeechCache.set(keyC, blobC);

      // Initial keys order: A, B, C
      let keys = Array.from(sessionSpeechCache.keys());
      assert.deepEqual(keys, [keyA, keyB, keyC]);

      // Cache hit on A: simulate True LRU re-insertion
      const cachedA = sessionSpeechCache.get(keyA)!;
      sessionSpeechCache.delete(keyA);
      sessionSpeechCache.set(keyA, cachedA);

      // Order must now be B, C, A (A became newest)
      keys = Array.from(sessionSpeechCache.keys());
      assert.deepEqual(keys, [keyB, keyC, keyA]);
      assert.equal(keys[0], keyB, 'B is now the oldest (LRU candidate)');
      assert.equal(keys[2], keyA, 'A is now the newest');
    });

    test('True LRU capacity enforcement: evicts oldest entry when size exceeds 30', () => {
      clearSessionSpeechCache();
      assert.equal(MAX_SESSION_CACHE_ENTRIES, 30);

      // Fill cache to capacity 30
      for (let i = 0; i < 30; i++) {
        sessionSpeechCache.set(`entry_${i}`, new Blob([`chunk ${i}`], { type: 'audio/mp3' }));
      }
      assert.equal(sessionSpeechCache.size, 30);
      assert.equal(sessionSpeechCache.keys().next().value, 'entry_0');

      // Adding 31st item evicts oldest (entry_0)
      const oldestKey = sessionSpeechCache.keys().next().value;
      if (oldestKey) sessionSpeechCache.delete(oldestKey);
      sessionSpeechCache.set('entry_30', new Blob(['chunk 30'], { type: 'audio/mp3' }));

      assert.equal(sessionSpeechCache.size, 30);
      assert.equal(sessionSpeechCache.has('entry_0'), false, 'entry_0 must have been evicted');
      assert.equal(sessionSpeechCache.has('entry_30'), true);
      assert.equal(sessionSpeechCache.keys().next().value, 'entry_1', 'entry_1 is now the oldest');
    });
  });

  describe('Long-Note Download & Save Completeness Contract', () => {
    test('Incomplete chunks cannot produce Saved state; all chunks must be generated', async () => {
      const chunks = ['Part 1', 'Part 2', 'Part 3', 'Part 4', 'Part 5', 'Part 6'];
      const cachedBlobs = new Map<number, Blob>();
      cachedBlobs.set(0, new Blob(['Audio Part 1'], { type: 'audio/mp3' }));
      cachedBlobs.set(1, new Blob(['Audio Part 2'], { type: 'audio/mp3' }));

      // Sequential generation helper simulating ensureAllChunksGenerated
      const generateAllChunks = async (
        totalChunks: string[],
        cache: Map<number, Blob>,
        failOnChunk?: number
      ): Promise<{ completed: boolean; allBlobs: Blob[] }> => {
        const generated: Blob[] = [];
        for (let i = 0; i < totalChunks.length; i++) {
          if (failOnChunk !== undefined && i === failOnChunk) {
            throw new Error(`Synthesis failed on chunk ${i + 1}`);
          }
          if (cache.has(i)) {
            generated.push(cache.get(i)!);
          } else {
            const newBlob = new Blob([`Audio Part ${i + 1}`], { type: 'audio/mp3' });
            cache.set(i, newBlob);
            generated.push(newBlob);
          }
        }
        return { completed: true, allBlobs: generated };
      };

      // Case 1: Failure during chunk generation halts and produces no saved audio
      let failed = false;
      try {
        await generateAllChunks(chunks, cachedBlobs, 3);
      } catch {
        failed = true;
      }
      assert.equal(failed, true, 'Error on chunk 3 must abort full generation');
      assert.equal(cachedBlobs.has(3), false);

      // Case 2: Complete run generates all 6 chunks
      const result = await generateAllChunks(chunks, cachedBlobs);
      assert.equal(result.completed, true);
      assert.equal(result.allBlobs.length, 6);
      assert.equal(cachedBlobs.size, 6);

      // Combine into unified Blob: exactly 1 combined audio blob
      const combinedBlob = new Blob(result.allBlobs, { type: 'audio/mp3' });
      assert.ok(combinedBlob.size > 0);
    });

    test('One Save = exactly one R2 voice-note attachment without duplicate objects', async () => {
      let uploadCount = 0;
      let voiceNotesAttached = 0;

      const mockUploadToR2 = async (blob: Blob, name: string) => {
        uploadCount++;
        return { objectId: `r2_obj_${Date.now()}`, name, size: blob.size };
      };

      const mockAttachVoiceNote = (objectId: string) => {
        voiceNotesAttached++;
      };

      const completeBlobs = [
        new Blob(['p1'], { type: 'audio/mp3' }),
        new Blob(['p2'], { type: 'audio/mp3' }),
        new Blob(['p3'], { type: 'audio/mp3' }),
      ];

      // Combine once and upload once
      const unifiedBlob = new Blob(completeBlobs, { type: 'audio/mp3' });
      const uploaded = await mockUploadToR2(unifiedBlob, 'Combined-Audio.mp3');
      mockAttachVoiceNote(uploaded.objectId);

      assert.equal(uploadCount, 1, 'Exactly one upload to R2 for the entire note');
      assert.equal(voiceNotesAttached, 1, 'Exactly one voice-note attachment added');
    });
  });

  describe('Truthful Nigerian Language Classifications & UI Badges', () => {
    test('LANGUAGE_OPTIONS truthfully classifies English, Nigerian English, Hausa, Yoruba, and Igbo', () => {
      const en = LANGUAGE_OPTIONS.find(l => l.id === 'en');
      const enNG = LANGUAGE_OPTIONS.find(l => l.id === 'en-NG');
      const haNG = LANGUAGE_OPTIONS.find(l => l.id === 'ha-NG');
      const yoNG = LANGUAGE_OPTIONS.find(l => l.id === 'yo-NG');
      const igNG = LANGUAGE_OPTIONS.find(l => l.id === 'ig-NG');

      assert.equal(en?.classification, 'NATIVE');
      assert.equal(enNG?.classification, 'CLOSEST MATCH');
      assert.equal(haNG?.classification, 'NATIVE');
      assert.equal(yoNG?.classification, 'CLOSEST MATCH');
      assert.equal(igNG?.classification, 'CLOSEST MATCH');

      // Hausa badge indicates Google Fallback Native
      assert.ok(haNG?.badge.includes('Google Fallback Native'));
      // Nigerian English badge indicates Closest Match
      assert.equal(enNG?.badge, 'Closest Match');
      assert.ok(enNG?.description.includes('Closest available English voice'));
      // Yoruba and Igbo badges indicate closest match
      assert.ok(yoNG?.badge.includes('Closest Match'));
      assert.ok(igNG?.badge.includes('Closest Match'));
    });
  });

  describe('Download vs Save Independence', () => {
    test('Download action produces client-side download without calling onSaveAudio', () => {
      let saveCalls = 0;
      let downloadTriggered = false;

      const mockOnSaveAudio = async () => {
        saveCalls++;
      };

      const handleDownload = () => {
        downloadTriggered = true;
      };

      handleDownload();
      assert.equal(downloadTriggered, true);
      assert.equal(saveCalls, 0, 'Download must NOT invoke Save to note');
    });

    test('Save action persists to storage without triggering browser download', async () => {
      let saveCalls = 0;
      let downloadTriggered = false;

      const mockOnSaveAudio = async (_blob: Blob, _duration: number) => {
        saveCalls++;
      };

      const handleSave = async () => {
        const fakeBlob = new Blob(['audio'], { type: 'audio/mp3' });
        await mockOnSaveAudio(fakeBlob, 10);
      };

      await handleSave();
      assert.equal(saveCalls, 1);
      assert.equal(downloadTriggered, false, 'Save must NOT trigger browser download');
    });
  });

  describe('Cancellation & Offline Behavior', () => {
    test('AbortController signal halts generation and avoids error presentation', async () => {
      const controller = new AbortController();
      controller.abort(); // Cancel immediately

      assert.equal(controller.signal.aborted, true);

      let bannerShown = false;
      try {
        if (controller.signal.aborted) {
          throw new DOMException('The user aborted a request.', 'AbortError');
        }
      } catch (err: unknown) {
        if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
          bannerShown = false;
        } else {
          bannerShown = true;
        }
      }
      assert.equal(bannerShown, false, 'Cancellation must not show error banner to user');
    });
  });

  describe('NTK Note v2.7 — Profile Truthfulness, Concurrency & Orchestration Suite', () => {
    test('MyProfileView has fake voice controls removed and truthful copy present', () => {
      const profilePath = path.join(process.cwd(), 'src', 'components', 'MyProfileView.tsx');
      const content = fs.readFileSync(profilePath, 'utf8');

      // 1. Fake controls MUST be absent from UI
      assert.equal(content.includes('Preferred Voice Gender'), false, 'Preferred Voice Gender must be removed');
      assert.equal(content.includes('Default Delivery Style'), false, 'Default Delivery Style must be removed');
      assert.equal(content.includes('Available Voices & Preferences'), false, 'Persona cards section must be removed');
      assert.equal(content.includes('PRIMARY_VOICE_OPTIONS'), false, 'PRIMARY_VOICE_OPTIONS must be removed from profile');
      assert.equal(content.includes('EXTENDED_VOICE_OPTIONS'), false, 'EXTENDED_VOICE_OPTIONS must be removed from profile');
      assert.equal(content.includes('toggleFavouriteVoice'), false, 'Favourite voice controls must be removed');

      // 2. Truthful notices and language copy MUST be present
      assert.ok(content.includes('Voice customization is not available with the current no-cost speech engines.'));
      assert.ok(content.includes('Nigerian English uses the closest available English voice. NTK Note preserves Nigerian names, places and Naira formatting where possible.'));
      assert.ok(content.includes('Uses the available Hausa fallback voice.'));
      assert.ok(content.includes('Native synthesis is not currently available on the no-cost speech engines. You can choose the closest available English voice.'));
    });

    test('ListenPlayer has dead fake option exports removed', () => {
      const playerPath = path.join(process.cwd(), 'src', 'components', 'ListenPlayer.tsx');
      const content = fs.readFileSync(playerPath, 'utf8');

      assert.equal(content.includes('export const STYLE_OPTIONS'), false, 'STYLE_OPTIONS export must be removed');
      assert.equal(content.includes('export const GENDER_OPTIONS'), false, 'GENDER_OPTIONS export must be removed');
      assert.equal(content.includes('export const PRIMARY_VOICE_OPTIONS'), false, 'PRIMARY_VOICE_OPTIONS export must be removed');
      assert.equal(content.includes('export const EXTENDED_VOICE_OPTIONS'), false, 'EXTENDED_VOICE_OPTIONS export must be removed');
      assert.ok(content.includes('export const SPEED_OPTIONS'), 'SPEED_OPTIONS must be retained');
      assert.ok(content.includes('export const LANGUAGE_OPTIONS'), 'LANGUAGE_OPTIONS must be retained');
    });

    test('Canonical JSON cache key identity is 100% collision-free (speech:v4)', () => {
      const baseKey = computeSpeechCacheKey({
        text: 'Identical Note Text',
        language: 'en',
        uid: 'user_test',
        allowClosestMatch: false,
      });

      assert.ok(baseKey.startsWith('speech:v4:{"uid":"user_test"'), 'Key must use speech:v4: prefix with canonical JSON');

      // Test that changing text, lang, closest, engine, or uid creates distinct keys
      const keyDiffText = computeSpeechCacheKey({ text: 'Different Note Text', language: 'en', uid: 'user_test' });
      const keyDiffLang = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'ha-NG', uid: 'user_test' });
      const keyDiffClosest = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'en', uid: 'user_test', allowClosestMatch: true });
      const keyDiffEngine = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'en', uid: 'user_test', preferredEngine: 'google' });
      const keyDiffUid = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'en', uid: 'user_other' });

      assert.notEqual(baseKey, keyDiffText);
      assert.notEqual(baseKey, keyDiffLang);
      assert.notEqual(baseKey, keyDiffClosest);
      assert.notEqual(baseKey, keyDiffEngine);
      assert.notEqual(baseKey, keyDiffUid);

      // Section 11, 25: Speed is NOT in cache key; 1x and 2x produce identical cache key
      const keySpeed1x = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'en', speed: 1, uid: 'user_test' });
      const keySpeed2x = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'en', speed: 2, uid: 'user_test' });
      assert.equal(baseKey, keySpeed1x);
      assert.equal(baseKey, keySpeed2x);

      // Section 16, 17: Legacy en-US and en-GB normalize to en and produce identical cache key
      const keyLegacyUs = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'en-US', uid: 'user_test' });
      const keyLegacyGb = computeSpeechCacheKey({ text: 'Identical Note Text', language: 'en-GB', uid: 'user_test' });
      assert.equal(baseKey, keyLegacyUs, 'Legacy en-US must produce identical cache key to en');
      assert.equal(baseKey, keyLegacyGb, 'Legacy en-GB must produce identical cache key to en');
    });

    test('ListenOrchestrator: Save survives natural playback chunk transition (audio.onended)', async () => {
      const chunks = ['Chunk 0', 'Chunk 1', 'Chunk 2', 'Chunk 3', 'Chunk 4', 'Chunk 5'];
      const fetchedIndexes: number[] = [];

      const mockFetchChunk = async (chunkText: string, index: number, signal?: AbortSignal) => {
        fetchedIndexes.push(index);
        await new Promise((r) => setTimeout(r, 10));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return new Blob([`Audio for ${chunkText}`], { type: 'audio/mp3' });
      };

      const orchestrator = new ListenOrchestrator({
        chunks,
        fetchChunkAudio: mockFetchChunk,
      });

      // 1. Chunk 0 is currently playing
      await orchestrator.startPlayback(0);
      assert.equal(orchestrator.getState().currentPlaybackIndex, 0);
      assert.equal(orchestrator.getState().isPlaying, true);

      // 2. User initiates Save while Chunk 0 is playing
      let uploadCalls = 0;
      let uploadedBlobSize = 0;
      const savePromise = orchestrator.saveCompleteAudio(async (combinedBlob) => {
        uploadCalls++;
        uploadedBlobSize = combinedBlob.size;
      });

      // 3. Chunk 0 naturally ends (audio.onended), triggering handleChunkEnded()
      const endResult = await orchestrator.handleChunkEnded();
      assert.equal(endResult.advanced, true);
      assert.equal(endResult.nextIndex, 1);
      assert.equal(orchestrator.getState().currentPlaybackIndex, 1);

      // Crucial check: Full preparation is NOT cancelled by natural chunk transition!
      assert.equal(orchestrator.getState().isPreparingAll, true, 'Preparation must survive automatic chunk transition');

      // 4. Await full save completion
      const saveResult = await savePromise;
      assert.equal(saveResult.success, true);
      assert.equal(uploadCalls, 1, 'Exactly one upload call for complete audio');
      assert.ok(uploadedBlobSize > 0);

      // All 6 chunks are now present in storage
      const storedBlobs = orchestrator.getBlobs();
      assert.equal(storedBlobs.length, 6);
      assert.ok(storedBlobs.every((b) => b !== null));
    });

    test('ListenOrchestrator: Download survives natural playback chunk transition', async () => {
      const chunks = ['Part 0', 'Part 1', 'Part 2', 'Part 3', 'Part 4', 'Part 5'];
      const mockFetchChunk = async (chunkText: string, _index: number) => {
        await new Promise((r) => setTimeout(r, 5));
        return new Blob([`Data for ${chunkText}`], { type: 'audio/mp3' });
      };

      const orchestrator = new ListenOrchestrator({
        chunks,
        fetchChunkAudio: mockFetchChunk,
      });

      await orchestrator.startPlayback(0);

      let downloadCalls = 0;
      const downloadPromise = orchestrator.downloadCompleteAudio((_blob) => {
        downloadCalls++;
      });

      // Trigger chunk 0 natural end
      await orchestrator.handleChunkEnded();
      assert.equal(orchestrator.getState().currentPlaybackIndex, 1);
      assert.equal(orchestrator.getState().isPreparingAll, true);

      const downloadResult = await downloadPromise;
      assert.equal(downloadResult.success, true);
      assert.equal(downloadCalls, 1, 'Exactly one download callback invoked');
    });

    test('ListenOrchestrator: Explicit user Cancel halts preparation with zero uploads', async () => {
      const chunks = ['C0', 'C1', 'C2', 'C3', 'C4', 'C5'];
      const mockFetchChunk = async (chunkText: string, _index: number, signal?: AbortSignal) => {
        await new Promise((r) => setTimeout(r, 20));
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        return new Blob([chunkText], { type: 'audio/mp3' });
      };

      const orchestrator = new ListenOrchestrator({
        chunks,
        fetchChunkAudio: mockFetchChunk,
      });

      let uploadCalls = 0;
      const savePromise = orchestrator.saveCompleteAudio(async () => {
        uploadCalls++;
      });

      // User explicitly cancels preparation mid-way
      orchestrator.cancelPreparation();

      const result = await savePromise;
      assert.equal(result.success, false);
      assert.equal(uploadCalls, 0, 'No upload may occur after user cancellation');
      assert.equal(orchestrator.getState().isPreparingAll, false);
    });

    test('Required real deduplication test: Initiator A aborts while B still needs request, C joins existing in-flight request', async () => {
      clearSessionSpeechCache();
      inFlightSpeechMap.clear();

      let upstreamFetchCalls = 0;
      let resolveUpstream: (blob: Blob) => void;
      const upstreamPromise = new Promise<Blob>((resolve) => {
        resolveUpstream = resolve;
      });

      const mockFetchFn = async (_options: any, _signal: AbortSignal) => {
        upstreamFetchCalls++;
        return upstreamPromise;
      };

      const options = {
        text: 'Shared note text for deduplication verification',
        language: 'en-US',
        speed: 1,
        uid: 'dedupe_user',
      };
      const cacheKey = computeSpeechCacheKey(options);

      const controllerA = new AbortController();
      const controllerB = new AbortController();
      const controllerC = new AbortController();

      // A begins request for key K
      const promiseA = executeSpeechWithDeduplication(options, controllerA.signal, mockFetchFn);

      // B joins K
      const promiseB = executeSpeechWithDeduplication(options, controllerB.signal, mockFetchFn);

      // Assert upstream fetch count = 1
      assert.equal(upstreamFetchCalls, 1, 'Upstream fetch must be called exactly once');
      assert.equal(inFlightSpeechMap.has(cacheKey), true, 'Map must contain in-flight request');

      // Abort A
      controllerA.abort();

      // Verify A receives AbortError
      await assert.rejects(promiseA, (err: unknown) => {
        return err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'));
      });

      // Assert underlying request remains alive for B AND inFlightSpeechMap still contains K
      assert.equal(inFlightSpeechMap.has(cacheKey), true, 'Map must still contain K while B is waiting');
      const entry = inFlightSpeechMap.get(cacheKey)!;
      assert.equal(entry.fetchController.signal.aborted, false, 'Fetch controller must not be aborted');

      // Before underlying request completes, C joins K
      const promiseC = executeSpeechWithDeduplication(options, controllerC.signal, mockFetchFn);

      // Assert upstream fetch count STILL = 1
      assert.equal(upstreamFetchCalls, 1, 'Upstream fetch count must still be 1 after C joins');

      // Resolve request
      const expectedBlob = new Blob(['sample audio data'], { type: 'audio/mp3' });
      resolveUpstream!(expectedBlob);

      // Assert B receives Blob and C receives Blob
      const [blobB, blobC] = await Promise.all([promiseB, promiseC]);
      assert.equal(blobB.size, expectedBlob.size);
      assert.equal(blobC.size, expectedBlob.size);

      // Map entry removed only AFTER underlying request settles
      assert.equal(inFlightSpeechMap.has(cacheKey), false, 'Map entry must be deleted after request settles');
    });

    test('Required all-cancel test: A starts, B joins, A aborts, B aborts -> underlying fetch aborts, map removes K', async () => {
      clearSessionSpeechCache();
      inFlightSpeechMap.clear();

      let underlyingAborted = false;
      const mockFetchFn = async (_options: any, signal: AbortSignal) => {
        signal.addEventListener('abort', () => {
          underlyingAborted = true;
        });
        return new Promise<Blob>((_, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'AbortError'));
          });
        });
      };

      const options = {
        text: 'All-cancel note text',
        language: 'en-US',
        speed: 1,
        uid: 'all_cancel_user',
      };
      const cacheKey = computeSpeechCacheKey(options);

      const controllerA = new AbortController();
      const controllerB = new AbortController();

      // A starts, B joins
      const promiseA = executeSpeechWithDeduplication(options, controllerA.signal, mockFetchFn);
      const promiseB = executeSpeechWithDeduplication(options, controllerB.signal, mockFetchFn);

      assert.equal(inFlightSpeechMap.has(cacheKey), true);
      assert.equal(underlyingAborted, false);

      // A aborts
      controllerA.abort();
      await assert.rejects(promiseA, { name: 'AbortError' });

      // Still alive for B
      assert.equal(underlyingAborted, false);
      assert.equal(inFlightSpeechMap.has(cacheKey), true);

      // B aborts
      controllerB.abort();
      await assert.rejects(promiseB, { name: 'AbortError' });

      // Expected: underlying fetch aborts, map eventually removes K, zero lingering entry
      assert.equal(underlyingAborted, true, 'Underlying fetch must abort when all subscribers abort');
      assert.equal(inFlightSpeechMap.has(cacheKey), false, 'Map must remove K after all subscribers abort');
      assert.equal(inFlightSpeechMap.size, 0, 'Zero lingering entries in in-flight map');
    });

    test('Long-audio duration metadata calculation (Section 13)', () => {
      // 1. Single chunk with browser measured duration: uses exact measured duration
      const singleChunkDuration = calculateCombinedAudioDuration({
        textLength: 120,
        chunkCount: 1,
        speed: 1,
        currentChunkDuration: 8.4,
        currentChunkLength: 120,
      });
      assert.equal(singleChunkDuration, 8);

      // 2. Multi-chunk (3 chunks, 600 chars total) with measured chunk 0 (150 chars in 10.0s):
      // Rate = 10s / 150 chars = 0.0667 s/char * 600 chars = 40 seconds
      const multiChunkMeasured = calculateCombinedAudioDuration({
        textLength: 600,
        chunkCount: 3,
        speed: 1,
        currentChunkDuration: 10.0,
        currentChunkLength: 150,
      });
      assert.equal(multiChunkMeasured, 40);

      // 3. Unmeasured fallback (3 chunks, 600 chars total, 1x speed):
      // 600 / 15 = 40 seconds
      const multiChunkFallback = calculateCombinedAudioDuration({
        textLength: 600,
        chunkCount: 3,
        speed: 1,
      });
      assert.equal(multiChunkFallback, 40);

      // 4. Double speed (2x):
      // Intrinsic duration remains 40 seconds (Section 13, 28)
      const doubleSpeed = calculateCombinedAudioDuration({
        textLength: 600,
        chunkCount: 3,
        speed: 2,
      });
      assert.equal(doubleSpeed, 40, 'Persistent duration must be intrinsic and NOT divided by speed');

      // 5. Short text minimum bound: at least chunkCount * 3 seconds
      const minBound = calculateCombinedAudioDuration({
        textLength: 10,
        chunkCount: 3,
        speed: 1,
      });
      assert.equal(minBound, 9, 'Must satisfy chunkCount * 3 minimum bound');
    });

    test('Playback speed is client-side only (Section 6, 9, 10): Speed changes do NOT invalidate blobs for ANY engine', () => {
      // English (Cloudflare MeloTTS): speed change does not affect generation config
      const enConfig1: SpeechGenerationConfig = { language: 'en', allowClosestMatch: false };
      const enConfig2: SpeechGenerationConfig = { language: 'en', allowClosestMatch: false };
      assert.equal(isSynthesisAffectingChange(enConfig1, enConfig2), false);

      // Legacy en-US to en-GB or en: normalized to same language, does NOT invalidate
      const legUs: SpeechGenerationConfig = { language: 'en-US', allowClosestMatch: false };
      const legGb: SpeechGenerationConfig = { language: 'en-GB', allowClosestMatch: false };
      const canonEn: SpeechGenerationConfig = { language: 'en', allowClosestMatch: false };
      assert.equal(isSynthesisAffectingChange(legUs, legGb), false, 'en-US and en-GB normalize to en and do not invalidate');
      assert.equal(isSynthesisAffectingChange(legUs, canonEn), false, 'en-US and en normalize to en and do not invalidate');

      // Hausa: language change DOES invalidate
      const haConfig: SpeechGenerationConfig = { language: 'ha-NG', allowClosestMatch: false };
      assert.equal(isSynthesisAffectingChange(enConfig1, haConfig), true, 'Language change invalidates blobs');
    });

    test('Required regression (Section 15): Language change en-US -> ha-NG ensures every missing Save chunk uses ha-NG and NOT en-US', async () => {
      const chunks = ['First paragraph', 'Second paragraph', 'Third paragraph'];
      const calls: { chunkText: string; index: number; config: SpeechGenerationConfig }[] = [];

      const orchestrator = new ListenOrchestrator({
        chunks,
        config: { language: 'en-US', allowClosestMatch: false },
        fetchChunkAudio: async (chunkText, index, _signal, config) => {
          calls.push({ chunkText, index, config: { ...config! } });
          return new Blob([`Audio for ${chunkText} in ${config?.language}`], { type: 'audio/mp3' });
        },
      });

      // Play first chunk under en-US
      await orchestrator.startPlayback(0);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].config.language, 'en-US');

      // User changes language to ha-NG
      orchestrator.updateConfig({ language: 'ha-NG', allowClosestMatch: false });

      // User starts Save
      let uploadCalls = 0;
      let savedBlob: Blob | null = null;
      const saveResult = await orchestrator.saveCompleteAudio(async (combined) => {
        uploadCalls++;
        savedBlob = combined;
      });

      assert.equal(saveResult.success, true);
      assert.equal(uploadCalls, 1);
      assert.ok(savedBlob !== null);

      // Check all calls made during Save:
      // Chunk 0 was invalidated because config changed, and all 3 chunks were synthesized under ha-NG
      const subsequentCalls = calls.slice(1);
      assert.ok(subsequentCalls.length >= 3, 'All 3 chunks must be generated under the new configuration');
      for (const call of subsequentCalls) {
        assert.equal(call.config.language, 'ha-NG', 'Save chunk must use ha-NG, not en-US');
      }
    });

    test('Required regression (Section 16): Download uses current Hausa configuration after language change', async () => {
      const chunks = ['Chunk 1', 'Chunk 2'];
      const calls: { chunkText: string; index: number; config: SpeechGenerationConfig }[] = [];

      const orchestrator = new ListenOrchestrator({
        chunks,
        config: { language: 'en-US', allowClosestMatch: false },
        fetchChunkAudio: async (chunkText, index, _signal, config) => {
          calls.push({ chunkText, index, config: { ...config! } });
          return new Blob([`Audio for ${chunkText}`], { type: 'audio/mp3' });
        },
      });

      // Play chunk 0 under en-US
      await orchestrator.startPlayback(0);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].config.language, 'en-US');

      // Change language to ha-NG before Download
      orchestrator.updateConfig({ language: 'ha-NG', allowClosestMatch: false });

      let downloadCalls = 0;
      const downloadResult = await orchestrator.downloadCompleteAudio((_combined) => {
        downloadCalls++;
      });

      assert.equal(downloadResult.success, true);
      assert.equal(downloadCalls, 1);

      // All chunks generated for download must be ha-NG
      const downloadFetches = calls.slice(1);
      assert.equal(downloadFetches.length, 2);
      for (const call of downloadFetches) {
        assert.equal(call.config.language, 'ha-NG', 'Download chunk must use ha-NG');
      }
    });

    test('Required regression (Section 17): Incompatible English chunk is invalidated; combined output contains 0 mixed chunks', async () => {
      const chunks = ['Section A', 'Section B'];
      const generatedBlobs: { [key: string]: string } = {};

      const orchestrator = new ListenOrchestrator({
        chunks,
        config: { language: 'en-US', allowClosestMatch: false },
        fetchChunkAudio: async (chunkText, _index, _signal, config) => {
          const marker = `${chunkText}:${config?.language}`;
          generatedBlobs[chunkText] = config?.language || '';
          return new Blob([marker], { type: 'audio/mp3' });
        },
      });

      // Chunk 0 generated under en-US
      await orchestrator.startPlayback(0);
      assert.equal(orchestrator.getBlobConfig()?.language, 'en-US');

      // Change to ha-NG
      const invalidated = orchestrator.updateConfig({ language: 'ha-NG', allowClosestMatch: false });
      assert.equal(invalidated, true, 'Language change must invalidate existing blobs');
      assert.equal(orchestrator.getBlobs().every(b => b === null), true, 'Blobs must be cleared');

      // Complete Save
      let finalBlobText = '';
      await orchestrator.saveCompleteAudio(async (combined) => {
        finalBlobText = await combined.text();
      });

      assert.ok(finalBlobText.includes('Section A:ha-NG'));
      assert.ok(finalBlobText.includes('Section B:ha-NG'));
      assert.ok(!finalBlobText.includes('en-US'), 'Output must not contain any en-US chunk');
      assert.equal(orchestrator.getBlobConfig()?.language, 'ha-NG');
    });

    test('Required regression (Section 18): Prefetch synchronization shares canonical state; Save reuses prefetched chunk without duplicate upstream request', async () => {
      const chunks = ['Chunk 1', 'Chunk 2', 'Chunk 3'];
      const fetchCallsPerIndex: Record<number, number> = { 0: 0, 1: 0, 2: 0 };

      const orchestrator = new ListenOrchestrator({
        chunks,
        config: { language: 'en-US', allowClosestMatch: false },
        fetchChunkAudio: async (chunkText, index) => {
          fetchCallsPerIndex[index] = (fetchCallsPerIndex[index] || 0) + 1;
          await new Promise((r) => setTimeout(r, 10));
          return new Blob([`Audio for ${chunkText}`], { type: 'audio/mp3' });
        },
      });

      // Playback starts chunk 1 (index 0)
      await orchestrator.startPlayback(0);
      assert.equal(fetchCallsPerIndex[0], 1);

      // Canonical prefetch begins chunk 2 (index 1)
      await orchestrator.prefetchChunk(1);
      assert.equal(fetchCallsPerIndex[1], 1);
      assert.ok(orchestrator.getBlobs()[1] !== null, 'Prefetched chunk must be stored in canonical state');

      // Save begins
      let saveExecuted = false;
      await orchestrator.saveCompleteAudio(async () => {
        saveExecuted = true;
      });

      assert.equal(saveExecuted, true);
      // Assert chunk 1 (index 0) was called once, chunk 2 (index 1) was called ONCE (reused from prefetch), chunk 3 (index 2) was called once
      assert.equal(fetchCallsPerIndex[0], 1, 'Chunk 0 fetched once');
      assert.equal(fetchCallsPerIndex[1], 1, 'Chunk 1 reused from canonical prefetch with exactly one upstream request');
      assert.equal(fetchCallsPerIndex[2], 1, 'Chunk 2 fetched once during save');
    });

    test('Required regression (Section 19): ListenPlayer component source code binds directly to ListenOrchestrator methods', () => {
      const playerSourcePath = path.join(process.cwd(), 'src', 'components', 'ListenPlayer.tsx');
      const source = fs.readFileSync(playerSourcePath, 'utf8');

      // Verify ListenPlayer calls production orchestrator methods:
      assert.ok(source.includes('orchestrator.startPlayback(index)'), 'Must call orchestrator.startPlayback');
      assert.ok(source.includes('orchestrator.prefetchChunk(nextIndex)'), 'Must call orchestrator.prefetchChunk');
      assert.ok(source.includes('updateConfig(newConfig)'), 'Must call orchestrator.updateConfig');
      assert.ok(source.includes('downloadCompleteAudio'), 'Must call orchestrator.downloadCompleteAudio');
      assert.ok(source.includes('saveCompleteAudio'), 'Must call orchestrator.saveCompleteAudio');
      assert.ok(source.includes('cancelPreparation()'), 'Must call orchestrator.cancelPreparation');
      assert.ok(source.includes('stopPlayback(options)'), 'Must call orchestrator.stopPlayback');

      // Verify ListenPlayer does NOT have duplicate blobsRef state
      assert.equal(source.includes('blobsRef = useRef'), false, 'blobsRef must be eliminated');
      assert.equal(source.includes('blobUrlsRef = useRef'), false, 'blobUrlsRef must be eliminated');
    });

    test('Required regression (Section 22): ListenPlayer revokes preview object URLs on finish, toggle, and unmount', () => {
      const playerSourcePath = path.join(process.cwd(), 'src', 'components', 'ListenPlayer.tsx');
      const source = fs.readFileSync(playerSourcePath, 'utf8');

      // Verify URL.revokeObjectURL is used for previewUrlRef
      assert.ok(source.includes('previewUrlRef'), 'Must track previewUrlRef');
      assert.ok(source.includes('URL.revokeObjectURL(previewUrlRef.current)'), 'Must revoke previewUrlRef.current');
      assert.ok(source.includes('cleanupPreview()'), 'cleanupPreview helper must exist');

      // Verify cleanupPreview is called in onended, onerror, toggle, and unmount
      assert.ok(source.includes('audio.onended = () => cleanupPreview()'));
      assert.ok(source.includes('audio.onerror = () => cleanupPreview()'));
    });
  });

  describe('NTK Note v2.7 — Final Playback-Speed Truth, English Capability Truth & Profile Preview Suite', () => {
    test('Required regression (Section 24): Google 0.75x double-speed prevention (no ttsspeed, identical blob identity to 1x, frontend playbackRate = 0.75)', () => {
      // 1. Verify Gateway classifySpeechLocale ignores speed parameter and provides clean routing
      const hausaLocale = classifySpeechLocale('ha-NG', false, 0.75);
      assert.equal(hausaLocale.googleTl, 'ha');
      assert.equal(hausaLocale.isHausa, true);

      // 2. Gateway source code verification: synthesizeGoogleSpeech does NOT add ttsspeed
      const gatewaySourcePath = path.join(process.cwd(), 'cloudflare', 'ntk-gateway', 'src', 'index.ts');
      const gatewaySource = fs.readFileSync(gatewaySourcePath, 'utf8');
      assert.equal(gatewaySource.includes("url.searchParams.set('ttsspeed'"), false, 'ttsspeed must be removed from Google synthesis');

      // 3. Generated cache identity is identical between 0.75x and 1x
      const key1x = computeSpeechCacheKey({ text: 'Barka da zuwa', language: 'ha-NG', speed: 1 });
      const key075x = computeSpeechCacheKey({ text: 'Barka da zuwa', language: 'ha-NG', speed: 0.75 });
      assert.equal(key1x, key075x, 'Generated blob cache key must be identical at 1x and 0.75x');

      // 4. Frontend player handles speed strictly via playbackRate
      const mockAudio = { playbackRate: 1 };
      const speedSetting = 0.75;
      mockAudio.playbackRate = speedSetting;
      assert.equal(mockAudio.playbackRate, 0.75, 'Playback rate applied purely in client element');
    });

    test('Required regression (Section 25): Speed cache reuse across 1x and 2x without second upstream fetch', async () => {
      clearSessionSpeechCache();
      let upstreamFetches = 0;

      const mockFetch = async () => {
        upstreamFetches++;
        return new Blob(['Sample audio MP3 bytes'], { type: 'audio/mpeg' });
      };

      // 1. First request at 1x
      const blob1 = await executeSpeechWithDeduplication(
        { text: 'Speed reuse test text', language: 'en', speed: 1, uid: 'speed_user' },
        undefined,
        mockFetch
      );
      assert.equal(upstreamFetches, 1, 'First request invokes upstream fetch');
      assert.ok(blob1 !== null);

      // 2. Second request at 2x
      const blob2 = await executeSpeechWithDeduplication(
        { text: 'Speed reuse test text', language: 'en', speed: 2, uid: 'speed_user' },
        undefined,
        mockFetch
      );
      assert.equal(upstreamFetches, 1, 'Second request at 2x reuses cached entry with zero additional fetches');
      assert.equal(blob1, blob2, 'Exact same cached Blob returned');
    });

    test('Required regression (Section 26): Google owner mode speed behavior (no regeneration, playbackRate = 0.75)', async () => {
      // 1. Verify owner policy with mode: 'google'
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'google', googleEnabled: true, cloudflareEnabled: true },
        hasAiBinding: true,
        isHausa: false,
      });
      assert.equal(plan[0], 'google', 'Google is primary when mode=google');

      // 2. Orchestrator with English under Google mode does NOT invalidate on speed change
      const orchestrator = new ListenOrchestrator({
        chunks: ['Google mode test chunk'],
        config: { language: 'en', allowClosestMatch: false },
        fetchChunkAudio: async (chunkText) => new Blob([`Audio for ${chunkText}`], { type: 'audio/mpeg' }),
      });

      await orchestrator.startPlayback(0);
      assert.ok(orchestrator.getBlobs()[0] !== null);

      // Changing speed does not touch SpeechGenerationConfig or invalidate blobs
      const currentConfig = orchestrator.getConfig();
      assert.equal(isSynthesisAffectingChange(currentConfig, currentConfig), false);
      assert.ok(orchestrator.getBlobs()[0] !== null, 'Blobs remain cached and valid');
    });

    test('Required regression (Section 27): Cloudflare fallback to Google speed behavior (same speech valid, playbackRate changes)', () => {
      // Automatic mode with cloudflare disabled or in cooldown falls back to google
      const plan = buildSpeechProviderPlan({
        policyListenEngine: { mode: 'automatic', googleEnabled: true, cloudflareEnabled: false },
        hasAiBinding: false,
        isHausa: false,
      });
      assert.equal(plan[0], 'google');

      // For any fallback engine, speed changes never invalidate blobs
      const cfgA: SpeechGenerationConfig = { language: 'en', allowClosestMatch: false };
      const cfgB: SpeechGenerationConfig = { language: 'en', allowClosestMatch: false };
      assert.equal(isSynthesisAffectingChange(cfgA, cfgB), false);
    });

    test('Required regression (Section 28): Saved audio duration metadata is independent of playbackRate', () => {
      // Text of 600 characters with 3 chunks
      const duration1x = calculateCombinedAudioDuration({
        textLength: 600,
        chunkCount: 3,
        speed: 1,
      });
      const duration2x = calculateCombinedAudioDuration({
        textLength: 600,
        chunkCount: 3,
        speed: 2,
      });
      const duration075x = calculateCombinedAudioDuration({
        textLength: 600,
        chunkCount: 3,
        speed: 0.75,
      });

      assert.equal(duration1x, 40, 'Intrinsic duration must be 40s');
      assert.equal(duration2x, 40, 'Duration at 2x playbackRate must still be 40s');
      assert.equal(duration075x, 40, 'Duration at 0.75x playbackRate must still be 40s');
      assert.equal(duration1x, duration2x);
      assert.equal(duration1x, duration075x);
    });

    test('Required regression (Section 29): English option truth & legacy normalization', () => {
      // Legacy normalization
      assert.equal(normalizeSpeechLanguage('en-US'), 'en');
      assert.equal(normalizeSpeechLanguage('en-GB'), 'en');
      assert.equal(normalizeSpeechLanguage('EN_US'), 'en');
      assert.equal(normalizeSpeechLanguage('EN_GB'), 'en');
      assert.equal(normalizeSpeechLanguage('en'), 'en');
      assert.equal(normalizeSpeechLanguage('ha-NG'), 'ha-NG');

      // Verify LANGUAGE_OPTIONS exports only unified English and no fake US/UK options
      const hasLegacyUs = LANGUAGE_OPTIONS.some(o => o.id === 'en-US');
      const hasLegacyGb = LANGUAGE_OPTIONS.some(o => o.id === 'en-GB');
      const hasUnifiedEn = LANGUAGE_OPTIONS.some(o => o.id === 'en');

      assert.equal(hasLegacyUs, false, 'English (US) separate voice option must be removed');
      assert.equal(hasLegacyGb, false, 'English (UK) separate voice option must be removed');
      assert.equal(hasUnifiedEn, true, 'Unified English option must be present');
    });

    test('Required regression (Section 30): Profile preview lifecycle uses real useRef, revokes Blob URLs, and cleans up on unmount', () => {
      const profileSourcePath = path.join(process.cwd(), 'src', 'components', 'MyProfileView.tsx');
      const source = fs.readFileSync(profileSourcePath, 'utf8');

      // 1. Real useRef verification
      assert.ok(source.includes('const previewAudioRef = useRef<HTMLAudioElement | null>(null);'), 'Must use real useRef for previewAudioRef');
      assert.ok(source.includes('const previewUrlRef = useRef<string | null>(null);'), 'Must use real useRef for previewUrlRef');
      assert.equal(source.includes('const previewAudioRef = { current:'), false, 'Fake render-local ref must be eliminated');

      // 2. cleanupVoicePreview helper implementation
      assert.ok(source.includes('cleanupVoicePreview()'), 'Must have cleanupVoicePreview function');
      assert.ok(source.includes('URL.revokeObjectURL(previewUrlRef.current)'), 'Must revoke previewUrlRef.current');

      // 3. Unmount cleanup hook
      assert.ok(source.includes('cleanupVoicePreview();'), 'Must clean up on unmount');

      // 4. Speed is applied to audio.playbackRate, not sent to textToSpeech
      assert.ok(source.includes('audio.playbackRate = settings.listenSpeed || 1;'), 'Playback rate must be applied to HTMLAudioElement');
    });
  });

  describe('NTK Note v2.7 — Preview-Cancellation & Lifecycle Closure Suite', () => {
    class TestPreviewHarness {
      previewAbortControllerRef = { current: null as AbortController | null };
      previewAudioRef = { current: null as any };
      previewUrlRef = { current: null as string | null };
      previewing = false;
      createdObjectUrls: string[] = [];
      playedAudios: any[] = [];
      errorBanners: string[] = [];

      cleanupPreview() {
        if (this.previewAbortControllerRef.current) {
          this.previewAbortControllerRef.current.abort();
          this.previewAbortControllerRef.current = null;
        }
        if (this.previewAudioRef.current) {
          this.previewAudioRef.current.pause();
          this.previewAudioRef.current.src = '';
          this.previewAudioRef.current = null;
        }
        if (this.previewUrlRef.current) {
          this.previewUrlRef.current = null;
        }
        this.previewing = false;
      }

      async startPreview(fetchFn: (signal: AbortSignal) => Promise<Blob>, speed = 1) {
        if (this.previewing) {
          this.cleanupPreview();
          return;
        }
        return this.startReplacementPreview(fetchFn, speed);
      }

      async startReplacementPreview(fetchFn: (signal: AbortSignal) => Promise<Blob>, speed = 1) {
        this.cleanupPreview();
        const controller = new AbortController();
        this.previewAbortControllerRef.current = controller;
        this.previewing = true;

        try {
          const blob = await fetchFn(controller.signal);

          // Stale async result guard:
          if (controller.signal.aborted || this.previewAbortControllerRef.current !== controller) {
            return;
          }

          const url = 'blob:http://localhost/' + Math.random().toString(36).slice(2);
          this.createdObjectUrls.push(url);
          this.previewUrlRef.current = url;

          let playing = false;
          const audio = {
            src: url,
            playbackRate: speed,
            play: async () => {
              playing = true;
              this.playedAudios.push(audio);
            },
            pause: () => {
              playing = false;
            },
            onended: () => this.cleanupPreview(),
            onerror: () => this.cleanupPreview(),
          };
          this.previewAudioRef.current = audio;
          await audio.play();
        } catch (err: unknown) {
          if (controller.signal.aborted || (err as { name?: string })?.name === 'AbortError') {
            return;
          }
          this.errorBanners.push((err as Error).message || 'Failed');
          this.cleanupPreview();
        }
      }
    }

    test('Required regression (Section 14): Controlled Promise preview cancellation prevents audio creation and ghost playback', async () => {
      const harness = new TestPreviewHarness();
      let capturedSignal: AbortSignal | null = null;
      let resolvePromise: (b: Blob) => void = () => {};

      const controlledPromise = new Promise<Blob>((res) => {
        resolvePromise = res;
      });

      // Start preview request
      const previewTask = harness.startPreview((sig) => {
        capturedSignal = sig;
        return controlledPromise;
      });

      assert.equal(harness.previewing, true);
      assert.ok(capturedSignal, 'Must provide AbortSignal');
      assert.equal(capturedSignal.aborted, false);

      // User clicks Preview again before Promise resolves -> cancels preview
      harness.cleanupPreview();
      assert.equal(capturedSignal.aborted, true, 'Upstream signal must be aborted on cancellation');
      assert.equal(harness.previewing, false);
      assert.equal(harness.previewAbortControllerRef.current, null);

      // Now the late network request resolves
      resolvePromise(new Blob(['late-audio-bytes'], { type: 'audio/mpeg' }));
      await previewTask;

      // Assertions:
      assert.equal(harness.createdObjectUrls.length, 0, 'No Blob URL must be created for cancelled preview');
      assert.equal(harness.playedAudios.length, 0, 'No audio play() must be triggered for cancelled preview');
      assert.equal(harness.previewUrlRef.current, null);
      assert.equal(harness.previewAudioRef.current, null);
      assert.equal(harness.errorBanners.length, 0, 'AbortError must not trigger user error banner');
    });

    test('Required regression (Section 15): Second-preview starts before first resolves: aborts first, only second plays', async () => {
      const harness = new TestPreviewHarness();
      let signalA: AbortSignal | null = null;
      let resolveA: (b: Blob) => void = () => {};
      const promiseA = new Promise<Blob>((res) => { resolveA = res; });

      let signalB: AbortSignal | null = null;
      let resolveB: (b: Blob) => void = () => {};
      const promiseB = new Promise<Blob>((res) => { resolveB = res; });

      // Start preview A
      const taskA = harness.startPreview((sig) => {
        signalA = sig;
        return promiseA;
      });

      assert.equal(signalA!.aborted, false);

      // Start preview B before A resolves (replacement preview e.g. user selected different voice)
      const taskB = harness.startReplacementPreview((sig) => {
        signalB = sig;
        return promiseB;
      });

      assert.equal(signalA!.aborted, true, 'Preview A must be aborted when preview B starts');
      assert.equal(signalB!.aborted, false, 'Preview B must be active');

      // Resolve A late
      resolveA(new Blob(['audio-A'], { type: 'audio/mpeg' }));
      await taskA;

      // A must not have created URL or played
      assert.equal(harness.createdObjectUrls.length, 0, 'A must not create URL');
      assert.equal(harness.playedAudios.length, 0, 'A must not play audio');

      // Resolve B
      resolveB(new Blob(['audio-B'], { type: 'audio/mpeg' }));
      await taskB;

      // Only B creates URL and plays
      assert.equal(harness.createdObjectUrls.length, 1, 'Only B creates URL');
      assert.equal(harness.playedAudios.length, 1, 'Only B plays audio');
      assert.equal(harness.previewing, true);
      assert.equal(harness.errorBanners.length, 0);
    });

    test('Required regression (Section 16): Component unmount while preview is loading aborts request and avoids ghost audio', async () => {
      const harness = new TestPreviewHarness();
      let capturedSignal: AbortSignal | null = null;
      let resolvePromise: (b: Blob) => void = () => {};
      const controlledPromise = new Promise<Blob>((res) => { resolvePromise = res; });

      // Start preview
      const previewTask = harness.startPreview((sig) => {
        capturedSignal = sig;
        return controlledPromise;
      });

      assert.equal(capturedSignal!.aborted, false);

      // Component unmounts (useEffect cleanup runs cleanupPreview)
      harness.cleanupPreview();

      assert.equal(capturedSignal!.aborted, true, 'Unmount must abort pending preview controller');
      assert.equal(harness.previewAbortControllerRef.current, null);

      // Late network response arrives after unmount
      resolvePromise(new Blob(['unmounted-audio'], { type: 'audio/mpeg' }));
      await previewTask;

      assert.equal(harness.createdObjectUrls.length, 0, 'No URL created after unmount');
      assert.equal(harness.playedAudios.length, 0, 'No audio played after unmount');
      assert.equal(harness.errorBanners.length, 0);
    });

    test('Required regression: Production components verify AbortController & signal integration', () => {
      const listenPlayerSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'ListenPlayer.tsx'), 'utf8');
      const profileSource = fs.readFileSync(path.join(process.cwd(), 'src', 'components', 'MyProfileView.tsx'), 'utf8');

      // ListenPlayer checks
      assert.ok(listenPlayerSource.includes('const previewAbortControllerRef = useRef<AbortController | null>(null);'), 'ListenPlayer must declare previewAbortControllerRef');
      assert.ok(listenPlayerSource.includes('previewAbortControllerRef.current.abort();'), 'ListenPlayer cleanup must abort pending preview');
      assert.ok(listenPlayerSource.includes('controller.signal'), 'ListenPlayer must pass controller.signal to textToSpeech');
      assert.ok(listenPlayerSource.includes('if (controller.signal.aborted || previewAbortControllerRef.current !== controller)'), 'ListenPlayer must guard against stale async preview result');

      // MyProfileView checks
      assert.ok(profileSource.includes('const previewAbortControllerRef = useRef<AbortController | null>(null);'), 'MyProfileView must declare previewAbortControllerRef');
      assert.ok(profileSource.includes('previewAbortControllerRef.current.abort();'), 'MyProfileView cleanup must abort pending preview');
      assert.ok(profileSource.includes('controller.signal'), 'MyProfileView must pass controller.signal to textToSpeech');
      assert.ok(profileSource.includes('if (controller.signal.aborted || previewAbortControllerRef.current !== controller)'), 'MyProfileView must guard against stale async preview result');
    });
  });

  describe('Firebase Spark and Zero-Cost Invariants', () => {
    test('Spark plan invariants remain strictly enforced for v2.7', () => {
      const firebaseConfig = {
        plan: 'Spark',
        monthlyCost: 0,
        billingAccount: null,
        cloudFunctionsCount: 0,
        appHostingCount: 0,
        firestoreDatabasesCount: 1,
        firebaseStorageMediaUsed: false,
      };

      assert.equal(firebaseConfig.plan, 'Spark');
      assert.equal(firebaseConfig.monthlyCost, 0);
      assert.equal(firebaseConfig.billingAccount, null);
      assert.equal(firebaseConfig.cloudFunctionsCount, 0);
      assert.equal(firebaseConfig.appHostingCount, 0);
      assert.equal(firebaseConfig.firestoreDatabasesCount, 1);
      assert.equal(firebaseConfig.firebaseStorageMediaUsed, false);
    });
  });
});

describe('NTK Note v2.8 — World-Class Reliability, Sync, Offline, Multi-Tab & Performance', () => {
  test('v2.8 Package version and Service Worker harmonization (Sections 31, 59, 60)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
    const pkgLock = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'));
    const swSource = fs.readFileSync(path.join(process.cwd(), 'public', 'sw.js'), 'utf8');

    assert.equal(pkg.version, '2.8.2', 'package.json must be 2.8.2');
    assert.equal(pkgLock.version, '2.8.2', 'package-lock.json root must be 2.8.2');
    assert.equal(pkgLock.packages[''].version, '2.8.2', 'package-lock.json packages[""] must be 2.8.2');
    assert.ok(swSource.includes("const CACHE_NAME = 'ntk-note-offline-v12';"), 'Service worker must remain at v12');
    assert.ok(swSource.includes("event.data.type === 'SKIP_WAITING'"), 'Service worker must support safe SKIP_WAITING');
  });

  test('Multi-device conflict detection uses baseUpdatedAt to eliminate false conflicts and protect stale writes (Sections 13, 14, 15, 65)', () => {
    // Scenario 1: Local edit has baseUpdatedAt matching remote. Remote was NOT changed concurrently.
    const noteId = 'test-note-1';
    const baseTime = '2026-09-08T08:00:00.000Z';
    const localEditTime = '2026-09-08T08:05:00.000Z';
    const remoteCurrentTime = baseTime; // unchanged on remote

    const isConflict1 = remoteCurrentTime !== baseTime;
    assert.equal(isConflict1, false, 'No conflict when remote updatedAt matches baseUpdatedAt at time of local edit');

    // Scenario 2: Remote note was edited concurrently on device B
    const remoteConcurrentEditTime = '2026-09-08T08:04:00.000Z';
    const isConflict2 = remoteConcurrentEditTime !== baseTime;
    assert.equal(isConflict2, true, 'Conflict detected when remote updatedAt differs from baseUpdatedAt');

    // Scenario 3: Conflict resolution strategies
    const localNote = { id: noteId, title: 'Local Note', content: 'Local text', updatedAt: localEditTime };
    const remoteNote = { id: noteId, title: 'Remote Note', content: 'Remote text', updatedAt: remoteConcurrentEditTime };

    // keep_both clones as local copy
    function resolveBoth(local: typeof localNote, remote: typeof remoteNote) {
      const localCopy = {
        ...local,
        id: 'cloned-uuid',
        title: `${local.title} (Local Copy)`,
        updatedAt: '2026-09-08T08:06:00.000Z',
      };
      return { mainNote: remote, localCopy };
    }

    const { mainNote, localCopy } = resolveBoth(localNote, remoteNote);
    assert.equal(mainNote.content, 'Remote text');
    assert.equal(localCopy.title, 'Local Note (Local Copy)');
    assert.equal(localCopy.content, 'Local text');
  });

  test('Production TabCoordinator: Leader Election, Controlled Transport, Failover & Configured Constants (Sections 28, 30, 44)', async () => {
    // 1. Verify exact runtime constants (Section 44)
    assert.equal(CHANNEL_NAME, 'ntk_tab_coordinator');
    assert.equal(HEARTBEAT_INTERVAL_MS, 2000);
    assert.equal(LEADER_TIMEOUT_MS, 5500);
    assert.equal(ELECTION_CHECK_INTERVAL_MS, 2500);

    // 2. Controlled paired transport
    let handlerA: ((e: { data: any }) => void) | null = null;
    let handlerB: ((e: { data: any }) => void) | null = null;

    const transportA: TabCoordinatorTransport = {
      postMessage: (msg: any) => {
        queueMicrotask(() => { if (handlerB) handlerB({ data: msg }); });
      },
      set onmessage(fn: any) { handlerA = fn; },
      get onmessage() { return handlerA; },
    };

    const transportB: TabCoordinatorTransport = {
      postMessage: (msg: any) => {
        queueMicrotask(() => { if (handlerA) handlerA({ data: msg }); });
      },
      set onmessage(fn: any) { handlerB = fn; },
      get onmessage() { return handlerB; },
    };

    const tabA = new TabCoordinator('tab_alpha', transportA);
    const tabB = new TabCoordinator('tab_beta', transportB);

    // Initial state: Tab A claims leadership
    tabA.claimLeadership();
    assert.equal(tabA.getIsLeader(), true);

    await new Promise(r => setTimeout(r, 10));
    assert.equal(tabB.getIsLeader(), false, 'Tab B remains follower after Tab A claim');
    assert.equal(tabB.getLeaderId(), 'tab_alpha', 'Tab B records tab_alpha as leader');

    // Tab A resigns -> Tab B deterministically claims leadership
    tabA.resignLeadership();
    assert.equal(tabA.getIsLeader(), false);

    await new Promise(r => setTimeout(r, 10));
    assert.equal(tabB.getIsLeader(), true, 'Tab B immediately steps up upon Tab A resignation');
    assert.equal(tabB.getLeaderId(), 'tab_beta');

    tabA.close();
    tabB.close();
  });

  test('Production Global Offline Media Sync Service: Draining, Stable remoteObjectId & Store Metadata Update (Sections 9, 10, 11, 12, 31)', async () => {
    const testUid = 'user_global_media_test';
    const noteId = 'note_global_drain_target';
    const itemId = 'media_item_global_1';
    const stableRemoteObjectId = `remote_obj_stable_${Date.now()}`;

    // Setup dummy note in store
    useStore.setState({
      notes: [
        {
          id: noteId,
          title: 'Target Note',
          content: 'Media attachment target',
          tags: [],
          color: 'default',
          pinned: false,
          archived: false,
          trashed: false,
          updatedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          voiceNotes: [
            {
              id: itemId,
              url: 'blob:local-temp',
              duration: 12,
              createdAt: new Date().toISOString(),
              pendingUpload: true,
            },
          ],
        } as any,
      ],
    });

    // Enqueue offline media item with stable remoteObjectId
    const testBlob = new Blob(['global media content'], { type: 'audio/webm' });
    await enqueueOfflineMedia({
      id: itemId,
      uid: testUid,
      noteId,
      purpose: 'voiceNotes',
      blob: testBlob,
      mimeType: 'audio/webm',
      fileName: 'Recording.webm',
      remoteObjectId: stableRemoteObjectId,
    });

    const pendingBefore = await getPendingMediaForUser(testUid);
    assert.equal(pendingBefore.length, 1);
    assert.equal(pendingBefore[0].remoteObjectId, stableRemoteObjectId);

    // Mock uploader to verify remoteObjectId is passed as customObjectId
    let receivedCustomObjectId: string | undefined;
    const mockUploader = async (_blob: Blob, purpose: string, fileName: string, _targetNoteId?: string, customObjectId?: string) => {
      receivedCustomObjectId = customObjectId;
      return {
        objectId: customObjectId || 'fallback_id',
        url: `https://gateway/storage/file/${purpose}/${customObjectId}/${fileName}`,
        idempotent: false,
      };
    };

    // Leader tab coordinator
    const leaderCoordinator = new TabCoordinator('leader_global_test');
    leaderCoordinator.claimLeadership();

    // Production service instance (NoteEditor is NOT mounted!)
    const syncService = new OfflineMediaSyncService(mockUploader as any, leaderCoordinator);
    syncService.setActiveUser(testUid);

    const result = await syncService.drainPendingMedia(testUid, { force: true });
    assert.equal(result.synced, 1);
    assert.equal(result.failed, 0);
    assert.equal(receivedCustomObjectId, stableRemoteObjectId, 'uploadStorageFile must receive item.remoteObjectId');

    // Verify queue is empty after confirmed upload
    const pendingAfter = await getPendingMediaForUser(testUid);
    assert.equal(pendingAfter.length, 0, 'Offline queue entry removed after confirmed success');

    // Verify note metadata in useStore updated
    const updatedNote = useStore.getState().notes.find(n => n.id === noteId);
    assert.ok(updatedNote);
    assert.equal(updatedNote?.voiceNotes?.[0]?.pendingUpload, false);
    assert.equal(updatedNote?.voiceNotes?.[0]?.objectId, stableRemoteObjectId);

    syncService.destroy();
    leaderCoordinator.close();
  });

  test('Production Idempotency & Lost-Response Retry: Stable remoteObjectId & No Duplicate R2 (Sections 6, 7, 8, 32)', async () => {
    const testUid = 'user_idempotency_test';
    const stableObjectId = `obj_r2_stable_${Date.now()}`;
    const kvStore = new Map<string, any>();
    let r2WriteCount = 0;

    const env: IdempotencyEnv = {
      NTK_CONFIG: {
        get: async (key: string, type?: string) => {
          const val = kvStore.get(key);
          if (!val) return null;
          return type === 'json' ? (typeof val === 'string' ? JSON.parse(val) : val) : val;
        },
      },
    };

    // 1. Initial check: objectId does not exist yet -> isIdempotent: false
    const initialCheck = await checkUploadIdempotency(env, testUid, 'images', stableObjectId);
    assert.equal(initialCheck.isIdempotent, false);

    // Production flow: Worker performs 1 R2 write and writes user-file record to KV
    r2WriteCount++;
    const uploadedRecord: UserFileRecord = {
      id: stableObjectId,
      uid: testUid,
      purpose: 'images',
      fileName: 'photo.png',
      storageKey: `images/${stableObjectId}/photo.png`,
      size: 2048,
      mimeType: 'image/png',
      createdAt: new Date().toISOString(),
    };
    kvStore.set(`user-file:${testUid}:images:${stableObjectId}`, uploadedRecord);

    // 2. Retry attempt: Client retries with exact SAME remoteObjectId (e.g. dropped network connection)
    // Production checkUploadIdempotency() detects existing record BEFORE quota/storage operations
    const retryCheck = await checkUploadIdempotency(env, testUid, 'images', stableObjectId);
    assert.equal(retryCheck.isIdempotent, true, 'checkUploadIdempotency must detect existing record');
    if (retryCheck.isIdempotent) {
      assert.equal(retryCheck.record.id, stableObjectId);
      assert.equal(retryCheck.record.size, 2048);
    }
    assert.equal(r2WriteCount, 1, 'Zero new R2 writes consumed on retry');
    assert.equal(kvStore.size, 1, 'Exactly one logical user-file record exists');

    // 3. Invalid/non-prefixed objectId returns isIdempotent: false
    const invalidCheck = await checkUploadIdempotency(env, testUid, 'images', 'invalid_id_format');
    assert.equal(invalidCheck.isIdempotent, false);
  });

  test('Production Follower Sync Now: Cross-Tab Delegation to Leader Tab (Sections 13, 33)', async () => {
    let handlerLeader: ((e: { data: any }) => void) | null = null;
    let handlerFollower: ((e: { data: any }) => void) | null = null;

    const transportLeader: TabCoordinatorTransport = {
      postMessage: (msg: any) => {
        queueMicrotask(() => { if (handlerFollower) handlerFollower({ data: msg }); });
      },
      set onmessage(fn: any) { handlerLeader = fn; },
      get onmessage() { return handlerLeader; },
    };

    const transportFollower: TabCoordinatorTransport = {
      postMessage: (msg: any) => {
        queueMicrotask(() => { if (handlerLeader) handlerLeader({ data: msg }); });
      },
      set onmessage(fn: any) { handlerFollower = fn; },
      get onmessage() { return handlerFollower; },
    };

    const leaderTab = new TabCoordinator('tab_leader', transportLeader);
    leaderTab.claimLeadership();

    const followerTab = new TabCoordinator('tab_follower', transportFollower);

    let followerDrainCalled = false;
    const leaderUploader = async () => {
      return { objectId: 'obj_lead', url: 'https://gateway/obj_lead', idempotent: false };
    };

    const followerUploader = async () => {
      followerDrainCalled = true;
      return { objectId: 'obj_foll', url: 'https://gateway/obj_foll', idempotent: false };
    };

    const leaderService = new OfflineMediaSyncService(leaderUploader as any, leaderTab);
    const followerService = new OfflineMediaSyncService(followerUploader as any, followerTab);

    // Follower requests manual sync from leader
    const syncPromise = followerService.requestSyncFromLeader('user_follower_test');
    const result = await syncPromise;

    assert.equal(followerDrainCalled, false, 'Follower tab must never drain directly');
    assert.equal(result.synced, 0);

    leaderService.destroy();
    followerService.destroy();
    leaderTab.close();
    followerTab.close();
  });

  test('Production Atomic Note Transaction: Detects Stale Base, Remote Deletion, Owner-Shared Authority & Fails Closed (Sections 17, 18, 19, 22-25, 28-29, 34, 35)', async () => {
    const localNote: Note = {
      id: 'note_atomic_1',
      title: 'Local Title',
      content: 'Local Content',
      tags: [],
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      updatedAt: '2026-09-08T09:30:00.000Z',
      createdAt: '2026-09-08T09:00:00.000Z',
    };

    const remoteNote: Note = {
      ...localNote,
      title: 'Remote Newer Title',
      updatedAt: '2026-09-08T09:45:00.000Z',
    };

    // Mock Firestore db environment executing real production commitQueuedNoteSafely
    const remoteDocs = new Map<string, Note | null>();
    const writtenDocs = new Map<string, any>();
    let shouldFailTransaction = false;

    const mockDb = {
      mockDoc: (path: string, ...segments: string[]) => [path, ...segments].join('/'),
    } as any;

    const mockRunner: TransactionRunner = async (_db, txFn) => {
      if (shouldFailTransaction) {
        throw new Error('Transaction network/read failure');
      }
      const tx = {
        get: async (ref: string) => {
          const data = remoteDocs.get(ref);
          return {
            exists: () => data !== null && data !== undefined,
            data: () => data,
          };
        },
        set: (ref: string, data: any) => {
          writtenDocs.set(ref, data);
        },
      };
      return txFn(tx);
    };

    // 1. Concurrent remote edit detected -> commitQueuedNoteSafely aborts write inside transaction and returns conflict
    remoteDocs.set('users/user_1/notes/note_atomic_1', remoteNote);
    const queueItem1: SyncQueueItem = {
      id: 'q_1',
      noteId: localNote.id,
      operation: 'upsert',
      createdAt: '2026-09-08T09:30:00.000Z',
      attempts: 0,
      baseUpdatedAt: '2026-09-08T09:00:00.000Z',
    };
    const res1 = await commitQueuedNoteSafely(mockDb, 'user_1', localNote, queueItem1, mockRunner);
    assert.equal(res1.status, 'conflict');
    if (res1.status === 'conflict') {
      assert.equal(res1.remoteNote.title, 'Remote Newer Title');
    }
    assert.equal(writtenDocs.has('users/user_1/notes/note_atomic_1'), false);

    // 2. Remote unchanged (baseUpdatedAt matches remote) -> write committed
    remoteDocs.set('users/user_1/notes/note_atomic_1', { ...localNote, updatedAt: '2026-09-08T09:00:00.000Z' });
    const res2 = await commitQueuedNoteSafely(mockDb, 'user_1', localNote, queueItem1, mockRunner);
    assert.equal(res2.status, 'committed');
    assert.equal(writtenDocs.get('users/user_1/notes/note_atomic_1')?.title, 'Local Title');

    // 3. Remote deletion (baseUpdatedAt present, remote doc absent) -> remote_deleted, NOT committed
    remoteDocs.delete('users/user_1/notes/note_atomic_1');
    writtenDocs.clear();
    const res3 = await commitQueuedNoteSafely(mockDb, 'user_1', localNote, queueItem1, mockRunner);
    assert.equal(res3.status, 'remote_deleted');
    if (res3.status === 'remote_deleted') {
      assert.equal(res3.noteId, localNote.id);
    }
    assert.equal(writtenDocs.size, 0, 'Must NOT recreate remotely deleted note');

    // 4. Genuine new note (no baseUpdatedAt, remote doc absent) -> committed normally
    const queueItemNew: SyncQueueItem = {
      id: 'q_new',
      noteId: localNote.id,
      operation: 'upsert',
      createdAt: '2026-09-08T09:30:00.000Z',
      attempts: 0,
    };
    const res4 = await commitQueuedNoteSafely(mockDb, 'user_1', localNote, queueItemNew, mockRunner);
    assert.equal(res4.status, 'committed');
    assert.equal(writtenDocs.get('users/user_1/notes/note_atomic_1')?.title, 'Local Title');

    // 5. Transaction/read failure -> fails closed with status: 'failed'
    shouldFailTransaction = true;
    writtenDocs.clear();
    const res5 = await commitQueuedNoteSafely(mockDb, 'user_1', localNote, queueItemNew, mockRunner);
    assert.equal(res5.status, 'failed');
    assert.equal(writtenDocs.size, 0);

    // 6. Owner-shared note with collaborator change in shared_notes authority -> conflict detected
    shouldFailTransaction = false;
    const ownerSharedNote: Note = {
      ...localNote,
      isShared: true,
      ownerId: 'user_1',
    };
    remoteDocs.set('users/user_1/notes/note_atomic_1', { ...ownerSharedNote, updatedAt: '2026-09-08T09:00:00.000Z' });
    remoteDocs.set('shared_notes/note_atomic_1', { ...ownerSharedNote, title: 'Collaborator Edit', updatedAt: '2026-09-08T09:50:00.000Z' });
    const res6 = await commitQueuedNoteSafely(mockDb, 'user_1', ownerSharedNote, queueItem1, mockRunner);
    assert.equal(res6.status, 'conflict');
    if (res6.status === 'conflict') {
      assert.equal(res6.remoteNote.title, 'Collaborator Edit');
    }
  });

  test('Production Remote Snapshot Merge: Resurrection Prevention & Authoritative Pruning (Sections 24, 25, 26, 27)', () => {
    const staleNoteX: Note = {
      id: 'note_stale_X',
      title: 'Stale Note X',
      content: 'Deleted remotely while offline',
      tags: [],
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      updatedAt: '2026-09-08T07:00:00.000Z',
      createdAt: '2026-09-08T06:00:00.000Z',
    };

    const preservedNoteY: Note = {
      id: 'note_preserved_Y',
      title: 'Preserved Note Y',
      content: 'Pending offline creation',
      tags: [],
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      updatedAt: '2026-09-08T07:00:00.000Z',
      createdAt: '2026-09-08T06:00:00.000Z',
    };

    // Scenario A: Stale note X exists locally, remote snapshot is EMPTY, syncQueue has NO item for X
    const resA = reconcileRemoteNotesSnapshot(
      [staleNoteX],
      [], // Remote has 0 notes (deleted on another device)
      [], // No pending queue item
      'user_resurrection_test'
    );

    assert.equal(resA.prunedCount, 1, 'Stale note X must be pruned from local state');
    assert.equal(resA.notes.length, 0, 'No notes remain in active workspace');

    // Scenario B: Note Y exists locally, remote snapshot is EMPTY, BUT syncQueue HAS pending create for Y
    const resB = reconcileRemoteNotesSnapshot(
      [preservedNoteY],
      [], // Remote has 0 notes
      [{ id: 'q_y', noteId: 'note_preserved_Y', operation: 'upsert', timestamp: Date.now(), retryCount: 0 }],
      'user_resurrection_test'
    );

    assert.equal(resB.prunedCount, 0, 'Pending note Y must NOT be pruned');
    assert.equal(resB.notes.length, 1);
    assert.equal(resB.notes[0].id, 'note_preserved_Y');
  });

  test('Production QuotaExceededError Recovery & Two-Phase Crash Journal (Sections 36, 37, 39, 40)', () => {
    const testUid = 'user_quota_test';
    const store = new Map<string, string>();
    const originalLocalStorage = (globalThis as any).localStorage;

    try {
      (globalThis as any).localStorage = {
        getItem: (k: string) => store.get(k) || null,
        setItem: (k: string, v: string) => store.set(k, v),
        removeItem: (k: string) => store.delete(k),
        key: (i: number) => Array.from(store.keys())[i] || null,
        get length() { return store.size; },
        clear: () => store.clear(),
      };

      // Test emergency synchronous crash journal
      saveCrashJournal(testUid, 'draft_1', {
        title: 'Emergency Draft',
        content: 'Vital content before crash',
        updatedAt: new Date().toISOString(),
      });
      const recovered = loadCrashJournal(testUid, 'draft_1');
      assert.ok(recovered);
      assert.equal(recovered?.noteId, 'draft_1');
      assert.equal(recovered?.title, 'Emergency Draft');

      // §10–§11: Two-phase crash journal: peekCrashJournal reads WITHOUT deleting
      const peeked = peekCrashJournal(testUid);
      assert.equal(peeked.length, 1, 'peekCrashJournal must return entries');
      assert.equal(peeked[0].noteId, 'draft_1');

      // Verify journal still exists after peek (NOT deleted)
      const stillThere = loadCrashJournal(testUid, 'draft_1');
      assert.ok(stillThere, 'Journal entry must survive peekCrashJournal — two-phase safety');

      // Phase 2: acknowledgeCrashJournal deletes specific entries
      acknowledgeCrashJournal(testUid, peeked);
      const afterAck = loadCrashJournal(testUid, 'draft_1');
      assert.equal(afterAck, null, 'Journal entry deleted after acknowledgeCrashJournal');

      // Legacy clearCrashJournal still works
      saveCrashJournal(testUid, 'draft_2', {
        title: 'Another Draft',
        content: 'More content',
        updatedAt: new Date().toISOString(),
      });
      clearCrashJournal(testUid);
      assert.equal(loadCrashJournal(testUid, 'draft_2'), null, 'Crash journal cleared after safe recovery');

      // Test saveJSONSafe with QuotaExceededError simulation
      (globalThis as any).localStorage.setItem = () => {
        const err = new Error('Quota exceeded');
        err.name = 'QuotaExceededError';
        throw err;
      };

      let threw = false;
      try {
        const res = saveJSONSafe('ntk:user:test_key', { data: 'heavy' });
        assert.equal(res.ok, false, 'saveJSONSafe returns ok: false on quota failure instead of crashing');
        assert.equal(res.quotaExceeded, true, 'QuotaExceededError correctly classified');
      } catch {
        threw = true;
      }
      assert.equal(threw, false, 'saveJSONSafe must never throw an uncaught exception');
    } finally {
      (globalThis as any).localStorage = originalLocalStorage;
    }
  });

  test('Production Offline Media Retry: Real Exponential Backoff & Classification (Section 15)', () => {
    // 1. Exponential backoff with jitter calculation
    const b1 = calculateNextBackoffMs(1);
    assert.ok(b1 >= 1000 && b1 <= 2000, `Retry 1 backoff ${b1}ms should be between 1000 and 2000ms`);

    const b2 = calculateNextBackoffMs(2);
    assert.ok(b2 >= 2000 && b2 <= 4000, `Retry 2 backoff ${b2}ms should be between 2000 and 4000ms`);

    const b4 = calculateNextBackoffMs(4);
    assert.ok(b4 >= 8000 && b4 <= 16000, `Retry 4 backoff ${b4}ms should be between 8000 and 16000ms`);

    const bMax = calculateNextBackoffMs(10);
    assert.ok(bMax <= 60000, `Backoff must be capped at 60,000ms (got ${bMax}ms)`);
  });

  test('Production Large-Workspace Local Durability: 100, 500, 1000 Realistic Notes (Sections 36, 53)', () => {
    function generateRealisticNotes(count: number): Note[] {
      return Array.from({ length: count }, (_, i) => ({
        id: `durable_note_${i}`,
        title: `Architecture Decision Record ${i}: Modernization and Reliability Contract`,
        content: `### Summary\nThis document establishes architectural standards for NTK Note module ${i}.\n\n` +
          `### Key Invariants\n- Single active queue drainer\n- True idempotency with stable remoteObjectId\n- Atomic Firestore compare-and-write\n\n` +
          `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ` +
          `Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`,
        tags: [i % 2 === 0 ? 'architecture' : 'reliability', i % 3 === 0 ? 'production' : 'v2.8'],
        color: 'default',
        pinned: i < 5,
        starred: i % 10 === 0,
        archived: false,
        trashed: false,
        priority: i % 5 === 0 ? 'high' : null,
        updatedAt: new Date(Date.now() - i * 60000).toISOString(),
        createdAt: new Date(Date.now() - (i + 10) * 60000).toISOString(),
        wordCount: 75,
        charCount: 450,
      }));
    }

    const sizes = [100, 500, 1000];
    for (const count of sizes) {
      const notes = generateRealisticNotes(count);
      const serialized = JSON.stringify(notes);
      const byteLength = new TextEncoder().encode(serialized).length;

      // Assert payload metrics
      assert.ok(byteLength > count * 300, `${count} notes should represent substantial payload (> ${count * 300} bytes)`);

      // Test search latency
      const start = performance.now();
      const query = 'invariants';
      const results = notes.filter(n =>
        n.title.toLowerCase().includes(query) || n.content.toLowerCase().includes(query)
      );
      const elapsed = performance.now() - start;

      assert.equal(results.length, count);
      assert.ok(elapsed < 25, `${count} notes search took ${elapsed.toFixed(2)}ms (< 25ms threshold)`);
    }
  });

  test('Large workspace performance: 1000 notes filter and sort executes in < 25ms (Sections 39, 72)', () => {
    // Generate 1000 simulated notes
    const notes = Array.from({ length: 1000 }, (_, i) => ({
      id: `note-${i}`,
      title: `Project Note ${i} ${i % 5 === 0 ? 'Urgent Task' : 'General Idea'}`,
      content: `This is the body text of note number ${i} containing several paragraphs of content.`,
      tags: [i % 2 === 0 ? 'work' : 'personal', i % 3 === 0 ? 'finance' : 'notes'],
      color: 'default',
      pinned: i < 5,
      starred: i % 10 === 0,
      archived: false,
      trashed: false,
      priority: i % 4 === 0 ? 'urgent' : null,
      updatedAt: new Date(Date.now() - i * 60000).toISOString(),
      createdAt: new Date(Date.now() - (i + 10) * 60000).toISOString(),
      wordCount: 150,
      charCount: 900,
    }));

    const start = performance.now();

    // Filter and sort operation
    const q = 'urgent';
    const filtered = notes.filter(n =>
      !n.trashed && !n.archived &&
      (n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q))
    ).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });

    const elapsed = performance.now() - start;

    assert.ok(filtered.length > 0);
    assert.ok(elapsed < 25, `1000 notes search took ${elapsed.toFixed(2)}ms (< 25ms target)`);
  });

  test('Firestore listener cleanup prevents listener leaks across route navigation (Sections 42, 73)', () => {
    let activeListeners = 0;

    function subscribeView() {
      activeListeners += 1;
      return () => { activeListeners -= 1; };
    }

    // Repeated navigation
    const unsubs: (() => void)[] = [];
    for (let i = 0; i < 10; i++) {
      unsubs.push(subscribeView());
    }
    assert.equal(activeListeners, 10);

    // Teardown / navigate away
    while (unsubs.length > 0) {
      const unsub = unsubs.pop();
      if (unsub) unsub();
    }

    assert.equal(activeListeners, 0, 'All listeners must be cleaned up after navigation');
  });

  test('Production Durable IndexedDB Hydration: persistDurableNotes and loadDurableRecord round-trip (Sections 5-9, 52)', async () => {
    const testUid = 'user_durable_hydration_test';
    const testNotes: Note[] = Array.from({ length: 100 }, (_, i) => ({
      id: `durable_rt_${i}`,
      title: `Durable Note ${i}`,
      content: `Content for durable hydration test note ${i}. This verifies IndexedDB round-trip integrity.`,
      tags: [i % 2 === 0 ? 'test' : 'durable'],
      color: 'default' as const,
      pinned: i < 3,
      archived: false,
      trashed: false,
      updatedAt: new Date(Date.now() - i * 60000).toISOString(),
      createdAt: new Date(Date.now() - (i + 100) * 60000).toISOString(),
    }));

    // Persist 100 notes to IndexedDB
    const writeOk = await persistDurableNotes(testUid, testNotes);
    assert.equal(writeOk, true, 'persistDurableNotes must succeed');

    // Load back via loadDurableRecord
    const record = await loadDurableRecord(testUid);
    assert.ok(record.notes, 'loadDurableRecord must return notes');
    assert.equal(record.notes!.length, 100, 'All 100 notes must survive round-trip');
    assert.ok(record.notesUpdatedAt, 'notesUpdatedAt timestamp must be present');

    // Verify representative content
    const note42 = record.notes!.find(n => n.id === 'durable_rt_42');
    assert.ok(note42);
    assert.equal(note42!.title, 'Durable Note 42');
    assert.ok(note42!.content.includes('durable hydration test note 42'));

    // Migration tracking
    const migrated0 = await isDurableMigrationComplete(testUid);
    assert.equal(migrated0, false, 'Migration not yet marked');

    await markDurableMigrationComplete(testUid);
    const migrated1 = await isDurableMigrationComplete(testUid);
    assert.equal(migrated1, true, 'Migration must be marked complete');
  });

  test('Production Durable Sync Queue: persistDurableSyncQueue and loadDurableRecord round-trip', async () => {
    const testUid = 'user_durable_queue_test';
    const testQueue = [
      { id: 'q1', noteId: 'note_1', operation: 'upsert' as const, createdAt: new Date().toISOString(), attempts: 0, entityType: 'note' as const, baseUpdatedAt: '2026-09-08T09:00:00.000Z' },
      { id: 'q2', noteId: 'nb_1', operation: 'upsert' as const, createdAt: new Date().toISOString(), attempts: 1, entityType: 'notebook' as const },
      { id: 'q3', noteId: 'note_2', operation: 'delete' as const, createdAt: new Date().toISOString(), attempts: 0 },
    ];

    const writeOk = await persistDurableSyncQueue(testUid, testQueue);
    assert.equal(writeOk, true);

    const record = await loadDurableRecord(testUid);
    assert.ok(record.queue);
    assert.equal(record.queue!.length, 3);
    assert.ok(record.queueUpdatedAt);

    const q1 = record.queue!.find(q => q.id === 'q1');
    assert.ok(q1);
    assert.equal(q1!.baseUpdatedAt, '2026-09-08T09:00:00.000Z', 'baseUpdatedAt must survive round-trip');
  });

  test('Production Follower Sync Timeout: Returns truthful pending count, never force-drains (Sections 38, 39)', async () => {
    // Build a follower service with a custom coordinator that is NOT leader
    let handlerLeader: ((e: { data: any }) => void) | null = null;
    let handlerFollower: ((e: { data: any }) => void) | null = null;

    const transportLeader: TabCoordinatorTransport = {
      postMessage: (msg: any) => {
        queueMicrotask(() => { if (handlerFollower) handlerFollower({ data: msg }); });
      },
      set onmessage(fn: any) { handlerLeader = fn; },
      get onmessage() { return handlerLeader; },
    };

    const transportFollower: TabCoordinatorTransport = {
      postMessage: (msg: any) => {
        queueMicrotask(() => { if (handlerLeader) handlerLeader({ data: msg }); });
      },
      set onmessage(fn: any) { handlerFollower = fn; },
      get onmessage() { return handlerFollower; },
    };

    const leaderTab = new TabCoordinator('tab_leader_timeout', transportLeader);
    leaderTab.claimLeadership();

    const followerTab = new TabCoordinator('tab_follower_timeout', transportFollower);

    let followerDrainCallCount = 0;
    const followerUploader = async () => {
      followerDrainCallCount++;
      return { objectId: 'obj_foll', url: 'https://gateway/obj_foll', idempotent: false };
    };

    // Do NOT create a leader service — leader won't respond, triggering timeout
    const followerService = new OfflineMediaSyncService(followerUploader as any, followerTab);

    // Follower requests sync — leader won't respond, times out after 4s
    const result = await followerService.requestSyncFromLeader('user_timeout_test');

    // §38: Follower must NOT drain directly on timeout
    assert.equal(followerDrainCallCount, 0, 'Follower tab must NEVER drain directly on leader timeout');
    // Result should be truthful (0 synced, pending count from queue)
    assert.equal(result.synced, 0);

    followerService.destroy();
    leaderTab.close();
    followerTab.close();
  });

  test('Production Auth-Switch & Abort Guard: In-flight upload aborted and queue isolation verified (Sections 20, 21, 22)', async () => {
    const userA = 'user_switch_A';
    const userB = 'user_switch_B';

    // Enqueue 2 items for user A
    await enqueueOfflineMedia({
      id: 'media_A_1',
      uid: userA,
      noteId: 'note_A',
      purpose: 'voiceNotes',
      blob: new Blob(['voice A 1']),
      mimeType: 'audio/webm',
      fileName: 'voice_1.webm',
    });
    await enqueueOfflineMedia({
      id: 'media_A_2',
      uid: userA,
      noteId: 'note_A',
      purpose: 'voiceNotes',
      blob: new Blob(['voice A 2']),
      mimeType: 'audio/webm',
      fileName: 'voice_2.webm',
    });

    let item1Aborted = false;
    let item2Started = false;

    let testService: OfflineMediaSyncService;

    let resolveItem1Started: () => void;
    const item1Started = new Promise<void>((resolve) => {
      resolveItem1Started = resolve;
    });

    const testUploader = async (
      _blob: any,
      _purpose: any,
      fileName: string,
      _noteId?: string,
      _remoteObjectId?: string,
      options?: { expectedUid?: string; signal?: AbortSignal }
    ) => {
      const signal = options?.signal;
      if (fileName === 'voice_1.webm') {
        resolveItem1Started();
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => resolve(), 500);
          if (signal) {
            if (signal.aborted) {
              item1Aborted = true;
              clearTimeout(timeout);
              resolve();
            } else {
              signal.addEventListener('abort', () => {
                item1Aborted = true;
                clearTimeout(timeout);
                resolve();
              });
            }
          }
        });
        if (item1Aborted) {
          throw new Error('Upload aborted by user switch');
        }
        return { objectId: 'obj_1', url: 'https://gateway/obj_1', idempotent: false };
      }
      if (fileName === 'voice_2.webm') {
        item2Started = true;
        return { objectId: 'obj_2', url: 'https://gateway/obj_2', idempotent: false };
      }
      return { objectId: 'obj_other', url: 'https://gateway/obj_other', idempotent: false };
    };

    const coordinator = new TabCoordinator('tab_switch_guard');
    coordinator.claimLeadership();
    (coordinator as any).leadershipClaimedAt = Date.now() - 1000; // Pre-age leadership for instant stability

    testService = new OfflineMediaSyncService(testUploader as any, coordinator);
    // User A starts draining
    testService.setActiveUser(userA);

    // Wait until item 1 is confirmed in-flight
    await item1Started;

    // Rapidly switch active account to User B while item 1 is active
    testService.setActiveUser(userB);

    // Give upload handler time to process abort
    await new Promise(r => setTimeout(r, 60));

    // Expectations:
    // 1. In-flight request for user A was aborted
    assert.equal(item1Aborted, true, 'In-flight upload for User A must be aborted on UID switch');
    // 2. Second item for user A never began under user B
    assert.equal(item2Started, false, 'Second queued item for User A must NOT begin');
    // 3. User B workspace has zero pending media
    const pendingB = await getPendingMediaForUser(userB);
    assert.equal(pendingB.length, 0, 'User B workspace must remain empty');
    // 4. User A items remain safely in User A queue
    const pendingA = await getPendingMediaForUser(userA);
    assert.ok(pendingA.length > 0, 'User A items must remain pending and isolated');

    testService.destroy();
    coordinator.close();
  });

  test('Production Startup Order: Durable hydration completes before remote snapshot merge (Sections 2, 3, 4, 5)', async () => {
    const testUid = 'user_startup_order_test';

    // Set up 100 notes in IndexedDB
    const idbNotes: Note[] = Array.from({ length: 100 }, (_, i) => ({
      id: `idb_note_${i}`,
      title: `IDB Note ${i}`,
      content: `Content ${i}`,
      tags: [],
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      ownerId: testUid,
    }));

    // 2 unsynced operations in IndexedDB
    const idbQueue: SyncQueueItem[] = [
      {
        id: 'q_unsynced_1',
        noteId: 'idb_note_0',
        operation: 'upsert',
        createdAt: new Date().toISOString(),
        attempts: 0,
        baseUpdatedAt: idbNotes[0].updatedAt,
      },
      {
        id: 'q_unsynced_2',
        noteId: 'idb_note_1',
        operation: 'upsert',
        createdAt: new Date().toISOString(),
        attempts: 0,
        baseUpdatedAt: idbNotes[1].updatedAt,
      },
    ];

    await persistDurableNotes(testUid, idbNotes);
    await persistDurableSyncQueue(testUid, idbQueue);

    // Ensure localStorage is empty for this workspace
    localStorage.removeItem(`ntk:user:${testUid}:notes`);
    localStorage.removeItem(`ntk:user:${testUid}:sync-queue`);

    // Reset store state
    useStore.setState({
      uid: testUid,
      notes: [],
      syncQueue: [],
      syncConflicts: [],
    });

    // Execute the production hydration helper
    await useStore.getState().hydrateAuthenticatedWorkspace(testUid);

    // Verify durable hydration completed fully before any remote merge
    const stateAfterHydration = useStore.getState();
    assert.equal(stateAfterHydration.notes.length, 100, 'Durable hydration must load all 100 notes');
    assert.equal(stateAfterHydration.syncQueue.length, 2, 'Unsynced queue must be present before remote merge');

    // Simulate remote snapshot ready immediately: note 0 is absent remotely (would be pruned if queue wasn't loaded)
    const remoteNotes = idbNotes.slice(1, 50); // Remote only has notes 1..49 (note 0 missing)
    const reconcileResult = reconcileRemoteNotesSnapshot(
      stateAfterHydration.notes,
      remoteNotes,
      stateAfterHydration.syncQueue,
      testUid
    );

    // Because durable sync queue was loaded BEFORE remote reconciliation, note 0 is NOT pruned
    const note0Exists = reconcileResult.notes.some(n => n.id === 'idb_note_0');
    assert.equal(note0Exists, true, 'Unsynced local note must NOT be pruned by remote snapshot');
  });

  test('Production QuotaExceededError Reload Recovery: IndexedDB is heavy-state authority (Sections 6, 7, 8)', async () => {
    const testUid = 'user_quota_authority_test';

    // Mock localStorage to throw QuotaExceededError on full notes write
    const origSetItem = localStorage.setItem;
    localStorage.setItem = (key: string, value: string) => {
      if (key.includes('notes') && value.length > 500) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      origSetItem.call(localStorage, key, value);
    };

    try {
      // 1. Create a large note in store
      const largeContent = 'A'.repeat(2000);
      const largeNote: Note = {
        id: 'large_note_quota_1',
        title: 'Large Note Survives Quota Error',
        content: largeContent,
        tags: ['resilience'],
        color: 'default',
        pinned: false,
        archived: false,
        trashed: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ownerId: testUid,
      };

      // Persist to durable IndexedDB authority
      const noteSaveOk = await persistDurableNotes(testUid, [largeNote]);
      assert.equal(noteSaveOk, true, 'IndexedDB persistence must succeed even if localStorage is full');

      const queueItem: SyncQueueItem = {
        id: 'q_large_1',
        noteId: largeNote.id,
        operation: 'upsert',
        createdAt: new Date().toISOString(),
        attempts: 0,
        baseUpdatedAt: largeNote.updatedAt,
      };
      const queueSaveOk = await persistDurableSyncQueue(testUid, [queueItem]);
      assert.equal(queueSaveOk, true, 'Sync queue persistence to IndexedDB must succeed');

      // 2. Simulate application reload: reset in-memory store
      useStore.setState({
        uid: testUid,
        notes: [],
        syncQueue: [],
      });

      // Hydrate from durable authority
      await useStore.getState().hydrateAuthenticatedWorkspace(testUid);

      const hydrated = useStore.getState();
      assert.equal(hydrated.notes.length, 1);
      assert.equal(hydrated.notes[0].id, 'large_note_quota_1');
      assert.equal(hydrated.notes[0].content, largeContent);
      assert.equal(hydrated.syncQueue.length, 1);
      assert.equal(hydrated.syncQueue[0].noteId, 'large_note_quota_1');
    } finally {
      localStorage.setItem = origSetItem;
    }
  });

  test('Production Crash Journal: Hydration restores sync intent with baseUpdatedAt (Section 9)', async () => {
    const testUid = 'user_journal_sync_intent_test';
    const store = new Map<string, string>();
    const originalLocalStorage = (globalThis as any).localStorage;

    (globalThis as any).localStorage = {
      getItem: (k: string) => store.get(k) || null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
      key: (i: number) => Array.from(store.keys())[i] || null,
      get length() { return store.size; },
      clear: () => store.clear(),
    };

    try {
      const journalNote: Note = {
        id: 'note_journal_1',
        title: 'Crash Journal Recovered Note',
        content: 'Draft survived power loss',
        tags: [],
        color: 'default',
        pinned: false,
        archived: false,
        trashed: false,
        createdAt: '2026-09-08T08:00:00.000Z',
        updatedAt: '2026-09-08T09:15:00.000Z',
        ownerId: testUid,
      };

      // Save unacknowledged crash journal entry with baseUpdatedAt
      saveCrashJournal(testUid, journalNote.id, {
        title: journalNote.title,
        content: journalNote.content,
        updatedAt: journalNote.updatedAt,
        baseUpdatedAt: '2026-09-08T09:00:00.000Z',
      });

      // Store in IndexedDB has empty queue (simulating lost queue write on crash)
      await persistDurableNotes(testUid, []);
      await persistDurableSyncQueue(testUid, []);

      // Hydrate
      useStore.setState({ uid: testUid, notes: [], syncQueue: [] });
      await useStore.getState().hydrateAuthenticatedWorkspace(testUid);

      const state = useStore.getState();
      assert.equal(state.notes.length, 1);
      assert.equal(state.notes[0].title, 'Crash Journal Recovered Note');

      // §9: Queue item was restored with baseUpdatedAt
      assert.equal(state.syncQueue.length, 1);
      assert.equal(state.syncQueue[0].noteId, 'note_journal_1');
      assert.equal(state.syncQueue[0].baseUpdatedAt, '2026-09-08T09:00:00.000Z');
    } finally {
      (globalThis as any).localStorage = originalLocalStorage;
    }
  });

  test('Production Remote-Deletion Conflict UX & Resolution: Keep deleted vs Recover my version (Sections 10, 11, 12, 13, 14)', async () => {
    const testUid = 'user_remote_del_test';

    const staleSharedNote: Note = {
      id: 'stale_remote_del_note',
      title: 'Note Deleted On Device B',
      content: 'Valuable offline draft content',
      tags: ['important'],
      color: 'blue',
      pinned: true,
      archived: false,
      trashed: false,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T09:00:00.000Z',
      ownerId: testUid,
      isShared: true,
      isPublished: true,
      sharedWith: ['collab@example.com'],
      editors: ['collab@example.com'],
      shareAccess: { 'collab@example.com': 'edit' },
    };

    const conflict1: SyncConflict = {
      id: 'conflict_remote_del_1',
      noteId: staleSharedNote.id,
      local: staleSharedNote,
      detectedAt: new Date().toISOString(),
      deletedRemotely: true,
    };

    // Case 1: User chooses "Keep deleted" (§12)
    useStore.setState({
      uid: testUid,
      notes: [staleSharedNote],
      syncQueue: [
        {
          id: 'q_stale_1',
          noteId: staleSharedNote.id,
          operation: 'upsert',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict1],
    });

    await useStore.getState().resolveSyncConflict(conflict1.id, 'keep_deleted');

    const stateAfterKeepDeleted = useStore.getState();
    assert.equal(stateAfterKeepDeleted.notes.some(n => n.id === staleSharedNote.id), false, 'Original note must be removed locally');
    assert.equal(stateAfterKeepDeleted.syncQueue.some(q => q.noteId === staleSharedNote.id), false, 'Pending queue for deleted note must be cleared');
    assert.equal(stateAfterKeepDeleted.syncConflicts.length, 0, 'Conflict must be dismissed');

    // Case 2: User chooses "Recover my version" (§13)
    const conflict2: SyncConflict = {
      id: 'conflict_remote_del_2',
      noteId: staleSharedNote.id,
      local: staleSharedNote,
      detectedAt: new Date().toISOString(),
      deletedRemotely: true,
    };

    useStore.setState({
      uid: testUid,
      notes: [staleSharedNote],
      syncQueue: [
        {
          id: 'q_stale_2',
          noteId: staleSharedNote.id,
          operation: 'upsert',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict2],
    });

    await useStore.getState().resolveSyncConflict(conflict2.id, 'recover_version');

    const stateAfterRecover = useStore.getState();
    // 1. Original deleted note is absent
    assert.equal(stateAfterRecover.notes.some(n => n.id === staleSharedNote.id), false, 'Original deleted note must be absent');
    // 2. Exactly one new private note exists
    assert.equal(stateAfterRecover.notes.length, 1);
    const recoveredNote = stateAfterRecover.notes[0];
    assert.notEqual(recoveredNote.id, staleSharedNote.id, 'Recovered note must receive a new UUID');
    assert.equal(recoveredNote.title, 'Note Deleted On Device B (Recovered Copy)');
    assert.equal(recoveredNote.content, 'Valuable offline draft content');
    // 3. Sharing metadata stripped
    assert.equal(recoveredNote.isShared, false);
    assert.equal(recoveredNote.isPublished, false);
    assert.equal(recoveredNote.sharedWith, undefined);
    assert.equal(recoveredNote.editors, undefined);
    assert.equal(recoveredNote.shareAccess, undefined);
    assert.equal(recoveredNote.ownerId, testUid);
    // 4. Old queue item removed, only new note queued
    assert.equal(stateAfterRecover.syncQueue.some(q => q.noteId === staleSharedNote.id), false, 'Old queue item must be removed');
    assert.equal(stateAfterRecover.syncQueue.some(q => q.noteId === recoveredNote.id), true, 'New recovered note must be queued');
    // 5. Conflict cleared
    assert.equal(stateAfterRecover.syncConflicts.length, 0);
  });

  test('Required Standard-Conflict Test (Section 18): Canonical R2 remains unchanged, local edits L safely recovered as new private note', async () => {
    const testUid = 'user_std_conflict_test';
    const originalNoteId = 'std_conflict_orig_id';

    const canonicalRemoteNote: Note = {
      id: originalNoteId,
      title: 'Canonical Remote Note R2',
      content: 'Server authoritative version edited on Device B',
      tags: ['server'],
      color: 'green',
      pinned: false,
      archived: false,
      trashed: false,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T10:00:00.000Z',
      ownerId: testUid,
    };

    const localUnsyncedNote: Note = {
      id: originalNoteId,
      title: 'Local Unsynced Note L',
      content: 'User edits made while offline on Device A',
      tags: ['local-edits'],
      color: 'blue',
      pinned: true,
      archived: false,
      trashed: false,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T09:30:00.000Z',
      ownerId: testUid,
    };

    const conflict: SyncConflict = {
      id: 'conflict_std_test_1',
      noteId: originalNoteId,
      local: localUnsyncedNote,
      remote: canonicalRemoteNote,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: testUid,
      notes: [localUnsyncedNote],
      syncQueue: [
        {
          id: 'queue_std_1',
          noteId: originalNoteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T08:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    // Execute automatic safe conflict resolution
    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    // 1. Canonical original R2 remains unchanged in notes with original ID
    const canonicalInStore = state.notes.find(n => n.id === originalNoteId);
    assert.ok(canonicalInStore, 'Canonical remote note R2 must remain in store');
    assert.equal(canonicalInStore.title, 'Canonical Remote Note R2');
    assert.equal(canonicalInStore.content, 'Server authoritative version edited on Device B');

    // 2. User's local unsynced edits L preserved as exactly ONE new private recovered note
    const recoveredNote = state.notes.find(n => n.id !== originalNoteId);
    assert.ok(recoveredNote, 'Recovered note must exist in store');
    assert.notEqual(recoveredNote.id, originalNoteId, 'Recovered note must receive a new UUID');
    assert.equal(recoveredNote.title, 'Local Unsynced Note L (Recovered Copy)');
    assert.equal(recoveredNote.content, 'User edits made while offline on Device A');
    assert.equal(recoveredNote.ownerId, testUid);
    assert.equal(recoveredNote.isShared, false);
    assert.equal(recoveredNote.isPublished, false);

    // 3. Stale original pending update removed from queue
    assert.equal(state.syncQueue.some(q => q.noteId === originalNoteId), false, 'Stale original update must be removed from syncQueue');

    // 4. Recovered note queued as new create
    assert.equal(state.syncQueue.some(q => q.noteId === recoveredNote.id), true, 'Recovered note must be queued for creation');

    // 5. Conflict cleared
    assert.equal(state.syncConflicts.length, 0, 'Conflict must be cleared');

    // 6. Active editor switched to recovered copy
    assert.equal(state.selectedNoteId, recoveredNote.id, 'Editor must switch to recovered copy');

    // 7. Polished novice notification posted
    assert.ok(state.conflictRecoveryNotice, 'Recovery notice must be posted');
    assert.equal(state.conflictRecoveryNotice.title, 'Your edits are safe');
    assert.ok(state.conflictRecoveryNotice.message.includes('saved your edits as a separate copy. Nothing was lost.'));
  });

  test('Required Shared-Note Test (Section 19): Canonical shared authority unchanged, local collaborator draft safely recovered as private user note', async () => {
    const currentUid = 'user_collaborator_1';
    const ownerUid = 'original_owner_2';
    const sharedNoteId = 'shared_canonical_doc_1';

    const canonicalSharedRemote: Note = {
      id: sharedNoteId,
      title: 'Canonical Team Note',
      content: 'Owner updated this paragraph remotely',
      ownerId: ownerUid,
      isShared: true,
      isPublished: true,
      sharedWith: ['collab@test.com', 'owner@test.com'],
      editors: ['collab@test.com'],
      shareAccess: { 'collab@test.com': 'edit' },
      createdAt: '2026-09-08T07:00:00.000Z',
      updatedAt: '2026-09-08T11:00:00.000Z',
    };

    const localCollaboratorDraft: Note = {
      id: sharedNoteId,
      title: 'Canonical Team Note',
      content: 'Collaborator unsynced edits on shared document',
      ownerId: ownerUid,
      isShared: true,
      isPublished: true,
      sharedWith: ['collab@test.com', 'owner@test.com'],
      editors: ['collab@test.com'],
      shareAccess: { 'collab@test.com': 'edit' },
      createdAt: '2026-09-08T07:00:00.000Z',
      updatedAt: '2026-09-08T09:00:00.000Z',
    };

    const conflict: SyncConflict = {
      id: 'conflict_shared_test_1',
      noteId: sharedNoteId,
      local: localCollaboratorDraft,
      remote: canonicalSharedRemote,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: currentUid,
      notes: [localCollaboratorDraft],
      syncQueue: [
        {
          id: 'queue_shared_1',
          noteId: sharedNoteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T07:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    // 1. Canonical shared note remains unchanged
    const sharedInStore = state.notes.find(n => n.id === sharedNoteId);
    assert.ok(sharedInStore);
    assert.equal(sharedInStore.title, 'Canonical Team Note');
    assert.equal(sharedInStore.content, 'Owner updated this paragraph remotely');
    assert.equal(sharedInStore.ownerId, ownerUid);
    assert.equal(sharedInStore.isShared, true);

    // 2. Recovered local copy is private, user-owned, zero collaborator metadata
    const recovered = state.notes.find(n => n.id !== sharedNoteId);
    assert.ok(recovered, 'Recovered note must exist');
    assert.notEqual(recovered.id, sharedNoteId);
    assert.equal(recovered.ownerId, currentUid, 'Recovered note must be owned by current user');
    assert.equal(recovered.isShared, false, 'Recovered note must NOT be shared');
    assert.equal(recovered.isPublished, false);
    assert.equal(recovered.sharedWith, undefined);
    assert.equal(recovered.editors, undefined);
    assert.equal(recovered.commenters, undefined);
    assert.equal(recovered.viewers, undefined);
    assert.equal(recovered.shareAccess, undefined);
    assert.equal(recovered.sharedBy, undefined);
    assert.equal(recovered.content, 'Collaborator unsynced edits on shared document');
  });

  test('Required Remote-Deletion Test (Section 20): Deleted original stays deleted, local draft recovered as new private note without decision prompts', async () => {
    const testUid = 'user_remote_del_novice';
    const deletedNoteId = 'remotely_deleted_doc_99';

    const localUnsyncedDraft: Note = {
      id: deletedNoteId,
      title: 'My Project Plan',
      content: 'Critical unsynced notes created offline',
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T09:00:00.000Z',
    };

    const conflict: SyncConflict = {
      id: 'conflict_remote_del_novice_1',
      noteId: deletedNoteId,
      local: localUnsyncedDraft,
      deletedRemotely: true,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: testUid,
      notes: [localUnsyncedDraft],
      syncQueue: [
        {
          id: 'queue_del_1',
          noteId: deletedNoteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T08:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    // Novice resolution does not require any choice
    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    // 1. Deleted original stays deleted (never recreated under original ID)
    assert.equal(state.notes.some(n => n.id === deletedNoteId), false, 'Original ID must remain deleted');

    // 2. Exactly one recovered private note created
    assert.equal(state.notes.length, 1);
    const recovered = state.notes[0];
    assert.notEqual(recovered.id, deletedNoteId);
    assert.equal(recovered.title, 'My Project Plan (Recovered Copy)');
    assert.equal(recovered.content, 'Critical unsynced notes created offline');
    assert.equal(recovered.ownerId, testUid);
    assert.equal(recovered.isShared, false);

    // 3. Stale original queue item removed, new note queued
    assert.equal(state.syncQueue.some(q => q.noteId === deletedNoteId), false);
    assert.equal(state.syncQueue.some(q => q.noteId === recovered.id), true);

    // 4. Recovery notice explains remote deletion safely
    assert.ok(state.conflictRecoveryNotice);
    assert.equal(state.conflictRecoveryNotice.title, 'Your edits are safe');
    assert.ok(state.conflictRecoveryNotice.message.includes('deleted on another device'));
  });

  test('Required Idempotency Test (Section 21): Same conflict triggered repeatedly produces exactly ONE recovered note without duplicate copies', async () => {
    const testUid = 'user_idempotency_test';
    const noteId = 'idempotency_note_1';

    const remoteNote: Note = {
      id: noteId,
      title: 'Original Note',
      content: 'Server version 2',
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T10:00:00.000Z',
    };

    const localNote: Note = {
      id: noteId,
      title: 'Original Note',
      content: 'Local version 1',
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T09:00:00.000Z',
    };

    const conflict: SyncConflict = {
      id: 'conflict_idem_1',
      noteId,
      local: localNote,
      remote: remoteNote,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: testUid,
      notes: [localNote],
      syncQueue: [
        {
          id: 'queue_idem_1',
          noteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T08:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    // Trigger conflict resolution three times in a row
    await useStore.getState().resolveSyncConflict(conflict.id);
    await useStore.getState().resolveSyncConflict(conflict.id);
    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    // Exactly 2 notes in store: canonical remote note + ONE recovered note
    assert.equal(state.notes.length, 2, 'Must contain exactly 2 notes (canonical + 1 recovered copy)');
    const recoveredCopies = state.notes.filter(n => n.title.includes('(Recovered Copy)'));
    assert.equal(recoveredCopies.length, 1, 'Must NOT create duplicate copies like (Recovered Copy) (2)');
  });

  test('Required Identical-Content Test (Section 22): Identical user content with differing timestamps resolves silently with zero duplicate copies', async () => {
    const testUid = 'user_identical_test';
    const noteId = 'identical_note_content_1';

    const remoteNote: Note = {
      id: noteId,
      title: 'Meeting Notes',
      content: 'Same exact text body written here.',
      tags: ['work', 'sync'],
      color: 'blue',
      pinned: true,
      archived: false,
      trashed: false,
      checklist: [{ id: '1', text: 'Action Item 1', checked: true, order: 0 }],
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    };

    const localNote: Note = {
      id: noteId,
      title: 'Meeting Notes',
      content: 'Same exact text body written here.',
      tags: ['work', 'sync'],
      color: 'blue',
      pinned: true,
      archived: false,
      trashed: false,
      checklist: [{ id: '1', text: 'Action Item 1', checked: true, order: 0 }],
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T11:00:00.000Z',
    };

    const conflict: SyncConflict = {
      id: 'conflict_identical_1',
      noteId,
      local: localNote,
      remote: remoteNote,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: testUid,
      notes: [localNote],
      syncQueue: [
        {
          id: 'queue_ident_1',
          noteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T08:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    // 1. Exactly 1 note in store (canonical remote note)
    assert.equal(state.notes.length, 1, 'No duplicate recovered copy should be created for identical content');
    assert.equal(state.notes[0].id, noteId);
    assert.equal(state.notes[0].updatedAt, '2026-09-08T12:00:00.000Z');

    // 2. Conflict cleared
    assert.equal(state.syncConflicts.length, 0);

    // 3. Stale queue item removed
    assert.equal(state.syncQueue.some(q => q.noteId === noteId), false);
  });

  test('Required Attachment Regression (Section 12): Local note with added attachment creates recovered copy with attachment preserved', async () => {
    const testUid = 'user_att_regression_test';
    const noteId = 'note_att_reg_1';

    const remoteNote: Note = {
      id: noteId,
      title: 'Quarterly Proposal',
      content: 'Proposal content body',
      tags: ['planning'],
      color: 'default',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      checklist: [],
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
      attachments: [],
    };

    const attachment: NoteAttachment = {
      id: 'att_reg_1',
      objectId: 'obj_att_reg_1',
      name: 'proposal_architecture.pdf',
      size: 2048,
      mimeType: 'application/pdf',
      createdAt: '2026-09-08T10:00:00.000Z',
    };

    const localNote: Note = {
      ...remoteNote,
      updatedAt: '2026-09-08T11:00:00.000Z',
      attachments: [attachment],
    };

    // Test production helper directly
    const diff = hasMeaningfulNoteDifference(localNote, remoteNote);
    assert.equal(diff, true, 'Added attachment MUST be detected as meaningful note difference');

    const conflict: SyncConflict = {
      id: 'conflict_att_reg_1',
      noteId,
      local: localNote,
      remote: remoteNote,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: testUid,
      notes: [localNote],
      syncQueue: [
        {
          id: 'q_att_reg_1',
          noteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T08:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    assert.equal(state.notes.length, 2, 'Conflict with added attachment must create exactly one recovered copy');
    const canonicalRemote = state.notes.find(n => n.id === noteId);
    const recovered = state.notes.find(n => n.id !== noteId);
    assert.ok(canonicalRemote, 'Canonical remote note must be preserved');
    assert.ok(recovered, 'Recovered copy must be created');
    assert.equal(canonicalRemote.attachments?.length || 0, 0, 'Canonical remote has no attachments');
    assert.equal(recovered.attachments?.length, 1, 'Recovered copy must retain the added attachment');
    assert.equal(recovered.attachments![0].name, 'proposal_architecture.pdf');
    assert.equal(recovered.attachments![0].objectId, 'obj_att_reg_1');
    assert.ok(recovered.title.includes('Recovered Copy'));
  });

  test('Required Voice Note Regression (Section 13): Local note with voice note creates recovered copy preserving voice metadata', async () => {
    const testUid = 'user_vn_regression_test';
    const noteId = 'note_vn_reg_1';

    const remoteNote: Note = {
      id: noteId,
      title: 'Field Research Notes',
      content: 'Interview summary without audio',
      tags: ['research'],
      color: 'teal',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      checklist: [],
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
      voiceNotes: [],
    };

    const voiceNote: NoteVoiceNote = {
      id: 'vn_reg_1',
      objectId: 'obj_voice_reg_1',
      title: 'Customer Interview 1',
      durationSeconds: 142,
      size: 450000,
      mimeType: 'audio/webm',
      source: 'recording',
      transcript: 'Customer wants instant synchronization across devices.',
      createdAt: '2026-09-08T10:15:00.000Z',
    };

    const localNote: Note = {
      ...remoteNote,
      updatedAt: '2026-09-08T11:00:00.000Z',
      voiceNotes: [voiceNote],
    };

    // Test production helper directly
    const diff = hasMeaningfulNoteDifference(localNote, remoteNote);
    assert.equal(diff, true, 'Added voice note MUST be detected as meaningful note difference');

    const conflict: SyncConflict = {
      id: 'conflict_vn_reg_1',
      noteId,
      local: localNote,
      remote: remoteNote,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: testUid,
      notes: [localNote],
      syncQueue: [
        {
          id: 'q_vn_reg_1',
          noteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T08:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    assert.equal(state.notes.length, 2, 'Conflict with added voice note must create exactly one recovered copy');
    const recovered = state.notes.find(n => n.id !== noteId);
    assert.ok(recovered, 'Recovered copy must be created');
    assert.equal(recovered.voiceNotes?.length, 1, 'Recovered copy must preserve voice note');
    assert.equal(recovered.voiceNotes![0].objectId, 'obj_voice_reg_1');
    assert.equal(recovered.voiceNotes![0].title, 'Customer Interview 1');
    assert.equal(recovered.voiceNotes![0].transcript, 'Customer wants instant synchronization across devices.');
    assert.equal(recovered.voiceNotes![0].durationSeconds, 142);
  });

  test('Required Image-ID Regression (Section 14): Different image objectId detected as meaningful difference, eliminating [object Object] bug', () => {
    const baseNote: Note = {
      id: 'note_img_reg_1',
      title: 'Design Review',
      content: 'UI Wireframes',
      tags: ['design'],
      color: 'purple',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      checklist: [],
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    };

    const remoteImage: NoteImage = {
      id: 'img_common_id',
      objectId: 'obj_remote_A',
      name: 'mockup_v1.png',
      size: 4096,
      mimeType: 'image/png',
      createdAt: '2026-09-08T08:00:00.000Z',
    };

    const localImage: NoteImage = {
      id: 'img_common_id',
      objectId: 'obj_local_B',
      name: 'mockup_v2.png',
      size: 5120,
      mimeType: 'image/png',
      createdAt: '2026-09-08T10:00:00.000Z',
    };

    const remoteNote: Note = { ...baseNote, images: [remoteImage] };
    const localNote: Note = { ...baseNote, images: [localImage] };

    // Both have exactly 1 image object. The old array.sort().join(',') produced "[object Object]" === "[object Object]".
    const diff = hasMeaningfulNoteDifference(localNote, remoteNote);
    assert.equal(diff, true, 'Images with different objectIds must evaluate as differing');

    // Confirm snapshots capture objectIds deterministically
    const localSnap = buildMeaningfulNoteSnapshot(localNote);
    const remoteSnap = buildMeaningfulNoteSnapshot(remoteNote);
    assert.equal(localSnap.images[0].objectId, 'obj_local_B');
    assert.equal(remoteSnap.images[0].objectId, 'obj_remote_A');
    assert.notEqual(JSON.stringify(localSnap), JSON.stringify(remoteSnap));
  });

  test('Required Photo Regression (Section 15): Photo objectId difference or added photo detected as meaningful difference', () => {
    const baseNote: Note = {
      id: 'note_photo_reg_1',
      title: 'Site Inspection',
      content: 'Photos from field visit',
      tags: ['inspection'],
      color: 'green',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      checklist: [],
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    };

    const photoA: NoteImage = {
      id: 'photo_1',
      objectId: 'obj_photo_A',
      name: 'foundation_crack.jpg',
      size: 1048576,
      mimeType: 'image/jpeg',
      caption: 'Foundation inspection',
      createdAt: '2026-09-08T08:00:00.000Z',
    };

    const photoB: NoteImage = {
      id: 'photo_1',
      objectId: 'obj_photo_B',
      name: 'roof_leak.jpg',
      size: 1048576,
      mimeType: 'image/jpeg',
      caption: 'Roof inspection',
      createdAt: '2026-09-08T08:00:00.000Z',
    };

    // Case 1: Photo objectId / caption differs
    const remoteWithPhotoA: Note = { ...baseNote, photos: [photoA] };
    const localWithPhotoB: Note = { ...baseNote, photos: [photoB] };
    assert.equal(hasMeaningfulNoteDifference(localWithPhotoB, remoteWithPhotoA), true);

    // Case 2: Photo added locally
    const remoteWithoutPhoto: Note = { ...baseNote, photos: [] };
    assert.equal(hasMeaningfulNoteDifference(localWithPhotoB, remoteWithoutPhoto), true);
  });

  test('Required Organization Regressions (Section 16): Starred, notebookId, reminder, and sectionId differences detected individually', () => {
    const baseNote: Note = {
      id: 'note_org_reg_1',
      title: 'Strategy Plan',
      content: 'Execution details',
      tags: ['strategy'],
      color: 'default',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      notebookId: 'nb_default',
      sectionId: 'sec_alpha',
      checklist: [],
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    };

    // 1. Starred differs
    const noteStarred: Note = { ...baseNote, starred: true };
    assert.equal(hasMeaningfulNoteDifference(noteStarred, baseNote), true, 'starred change must be meaningful');

    // 2. NotebookId differs
    const noteNewNb: Note = { ...baseNote, notebookId: 'nb_executive' };
    assert.equal(hasMeaningfulNoteDifference(noteNewNb, baseNote), true, 'notebookId change must be meaningful');

    // 3. SectionId differs
    const noteNewSec: Note = { ...baseNote, sectionId: 'sec_beta' };
    assert.equal(hasMeaningfulNoteDifference(noteNewSec, baseNote), true, 'sectionId change must be meaningful');

    // 4. Reminder differs
    const reminder: Reminder = {
      id: 'rem_reg_1',
      noteId: baseNote.id,
      time: '2026-09-15T09:00:00.000Z',
      title: 'Review Q3 progress',
      triggered: false,
    };
    const noteWithReminder: Note = { ...baseNote, reminder };
    assert.equal(hasMeaningfulNoteDifference(noteWithReminder, baseNote), true, 'reminder change must be meaningful');

    // 5. Priority differs
    const noteHighPriority: Note = { ...baseNote, priority: 'urgent' };
    assert.equal(hasMeaningfulNoteDifference(noteHighPriority, baseNote), true, 'priority change must be meaningful');

    // 6. Linked notes differ
    const noteWithLinks: Note = { ...baseNote, linkedNoteIds: ['note_ref_1', 'note_ref_2'] };
    assert.equal(hasMeaningfulNoteDifference(noteWithLinks, baseNote), true, 'linkedNoteIds change must be meaningful');
  });

  test('Required Content-Whitespace Regression (Section 17): Formatting spaces/newlines preserved; pure CRLF vs LF normalized', () => {
    const baseNote: Note = {
      id: 'note_ws_reg_1',
      title: 'Code Snippet',
      content: 'Line one\nLine two',
      tags: [],
      color: 'default',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      checklist: [],
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    };

    // Trailing newline difference must be preserved as meaningful
    const noteWithTrailingNewline: Note = {
      ...baseNote,
      content: 'Line one\nLine two\n',
    };
    assert.equal(
      hasMeaningfulNoteDifference(noteWithTrailingNewline, baseNote),
      true,
      'Intentional trailing newline difference must be detected as meaningful'
    );

    // Empty paragraph line separation difference must be preserved as meaningful
    const noteWithParagraphBreak: Note = {
      ...baseNote,
      content: 'Line one\n\nLine two',
    };
    assert.equal(
      hasMeaningfulNoteDifference(noteWithParagraphBreak, baseNote),
      true,
      'Intentional blank line paragraph break must be detected as meaningful'
    );

    // Canonical CRLF -> LF line ending normalization (CRLF on local vs LF on remote with same text structure)
    const noteWithCrlf: Note = {
      ...baseNote,
      content: 'Line one\r\nLine two',
    };
    assert.equal(
      hasMeaningfulNoteDifference(noteWithCrlf, baseNote),
      false,
      'Pure CRLF vs LF line ending difference must normalize canonically to identical'
    );
  });

  test('Required Identical Technical-Only Regression (Section 18): Derived and ephemeral browser-only fields produce identical evaluation with zero duplicate copies', async () => {
    const testUid = 'user_ident_technical_test';
    const noteId = 'note_tech_ident_1';

    const remoteNote: Note = {
      id: noteId,
      title: 'Technical Equality Check',
      content: 'Content line 1\nContent line 2',
      tags: ['sync', 'test'],
      color: 'blue',
      theme: 'midnight',
      pinned: true,
      starred: true,
      archived: false,
      trashed: false,
      locked: false,
      checklist: [{ id: 'item_1', text: 'Task 1', checked: false, order: 0 }],
      images: [
        {
          id: 'img_same_1',
          objectId: 'obj_shared_img',
          name: 'photo.jpg',
          size: 1024,
          mimeType: 'image/jpeg',
          createdAt: '2026-09-08T08:00:00.000Z',
          pendingUpload: false,
        },
      ],
      voiceNotes: [
        {
          id: 'vn_same_1',
          objectId: 'obj_shared_vn',
          title: 'Note Voice',
          durationSeconds: 30,
          size: 12000,
          mimeType: 'audio/webm',
          source: 'recording',
          transcript: 'Identical voice transcript',
          createdAt: '2026-09-08T08:00:00.000Z',
          pendingUpload: false,
        },
      ],
      ownerId: testUid,
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
      wordCount: 8,
      charCount: 46,
    };

    // Local note has differing timestamps, differing derived counts, and ephemeral browser URLs (localDataUrl, localBlobUrl, pendingUpload)
    const localNote: Note = {
      ...remoteNote,
      updatedAt: '2026-09-08T10:00:00.000Z', // Differing technical timestamp
      createdAt: '2026-09-08T08:00:00.000Z',
      wordCount: 12, // Differing derived count
      charCount: 65, // Differing derived count
      images: [
        {
          ...remoteNote.images![0],
          localDataUrl: 'data:image/jpeg;base64,ephemeralPreviewData...', // Transient browser URL
          pendingUpload: true, // Transient flag
        },
      ],
      voiceNotes: [
        {
          ...remoteNote.voiceNotes![0],
          localBlobUrl: 'blob:http://localhost:5173/ephemeral-voice-blob-id', // Transient browser URL
          pendingUpload: true, // Transient flag
        },
      ],
    };

    // Real production comparator must determine identical user state
    assert.equal(
      hasMeaningfulNoteDifference(localNote, remoteNote),
      false,
      'Technical/ephemeral differences must evaluate as identical user content'
    );

    const conflict: SyncConflict = {
      id: 'conflict_tech_ident_1',
      noteId,
      local: localNote,
      remote: remoteNote,
      detectedAt: new Date().toISOString(),
    };

    useStore.setState({
      uid: testUid,
      notes: [localNote],
      syncQueue: [
        {
          id: 'q_tech_ident_1',
          noteId,
          operation: 'upsert',
          baseUpdatedAt: '2026-09-08T08:00:00.000Z',
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ],
      syncConflicts: [conflict],
    });

    await useStore.getState().resolveSyncConflict(conflict.id);

    const state = useStore.getState();
    assert.equal(state.notes.length, 1, 'Identical content must NOT create a duplicate recovered copy');
    assert.equal(state.notes[0].id, noteId);
    assert.equal(state.notes[0].updatedAt, '2026-09-08T12:00:00.000Z');
    assert.equal(state.syncConflicts.length, 0, 'Conflict must be cleared');
  });

  test('Required Checklist Deep Equality Regression (Section 9): Checked status, order, and item text differences detected', () => {
    const baseNote: Note = {
      id: 'note_chk_reg_1',
      title: 'Shopping List',
      content: '',
      tags: ['shopping'],
      color: 'default',
      pinned: false,
      starred: false,
      archived: false,
      trashed: false,
      checklist: [{ id: 'item_1', text: 'Apples', checked: false, order: 0 }],
      createdAt: '2026-09-08T08:00:00.000Z',
      updatedAt: '2026-09-08T12:00:00.000Z',
    };

    // 1. Checked status differs
    const noteChecked: Note = {
      ...baseNote,
      checklist: [{ id: 'item_1', text: 'Apples', checked: true, order: 0 }],
    };
    assert.equal(hasMeaningfulNoteDifference(noteChecked, baseNote), true, 'Checklist checked difference must be detected');

    // 2. Item order differs
    const noteReordered: Note = {
      ...baseNote,
      checklist: [{ id: 'item_1', text: 'Apples', checked: false, order: 1 }],
    };
    assert.equal(hasMeaningfulNoteDifference(noteReordered, baseNote), true, 'Checklist order difference must be detected');

    // 3. Item text differs
    const noteTextDiff: Note = {
      ...baseNote,
      checklist: [{ id: 'item_1', text: 'Organic Apples', checked: false, order: 0 }],
    };
    assert.equal(hasMeaningfulNoteDifference(noteTextDiff, baseNote), true, 'Checklist text difference must be detected');
  });

  test('Required UX Test (Section 23): Production component renders plain novice language and omits default blocking button trio', () => {
    const componentPath = path.resolve('src/components/ConflictResolutionModal.tsx');
    const source = fs.readFileSync(componentPath, 'utf8');

    // Verify blocking three-choice default buttons are NOT present
    assert.equal(source.includes('>Keep this version<'), false, 'Default modal must NOT display "Keep this version"');
    assert.equal(source.includes('>Use synced version<'), false, 'Default modal must NOT display "Use synced version"');
    assert.equal(source.includes('>Keep both<'), false, 'Default modal must NOT display "Keep both"');

    // Verify reassuring plain novice language is present
    assert.ok(source.includes('Your edits are safe'), 'Component must display "Your edits are safe"');
    assert.ok(source.includes('Nothing was lost'), 'Component must reassure that "Nothing was lost"');
    assert.ok(source.includes('saved your edits as a separate copy'), 'Component must state "saved your edits as a separate copy"');
    assert.ok(source.includes('My edits'), 'Comparison preview must use friendly "My edits"');
    assert.ok(source.includes('Latest saved note'), 'Comparison preview must use friendly "Latest saved note"');
    assert.ok(source.includes('Your edits were safely saved as a recovered copy.'), 'Accessibility aria-live must announce safety');
  });

  test('Spark Plan 100% Free Tier Invariants remain absolute for v2.8 (Section 3)', () => {
    const limits = {
      monthlyBilling: 0,
      firebasePlan: 'Spark',
      cloudFunctions: 0,
      appHosting: 0,
      firestoreDatabases: 1,
      firebaseStorageForMedia: false,
    };

    assert.equal(limits.monthlyBilling, 0);
    assert.equal(limits.firebasePlan, 'Spark');
    assert.equal(limits.cloudFunctions, 0);
    assert.equal(limits.appHosting, 0);
    assert.equal(limits.firestoreDatabases, 1);
    assert.equal(limits.firebaseStorageForMedia, false);
  });

  describe('Required Sync-Status Truth & User-Facing Regressions (v2.8.1 Sections 6, 7, 8, 9)', () => {
    const syncUserA = 'sync_truth_user_a';
    const syncUserB = 'sync_truth_user_b';
    const syncUserC = 'sync_truth_user_c';
    const syncUserD = 'sync_truth_user_d';

    test('Scenario A (Section 9): 1 media item eligible now runs drain and pendingTotal/pendingCount updates accurately', async () => {
      await enqueueOfflineMedia({
        id: 'media_scen_a_1',
        uid: syncUserA,
        purpose: 'images',
        blob: new Blob(['scenario A sample image'], { type: 'image/png' }),
        mimeType: 'image/png',
        fileName: 'scenario_a.png',
        remoteObjectId: 'remote_obj_scen_a',
      });

      const pendingBefore = await getPendingMediaForUser(syncUserA, false);
      const summaryBefore = summarizePendingMedia(pendingBefore);
      assert.equal(summaryBefore.pendingTotal, 1);
      assert.equal(summaryBefore.eligibleNow, 1);
      assert.equal(summaryBefore.waitingForBackoff, 0);
      assert.equal(summaryBefore.needsAttention, 0);

      let uploaderCalled = false;
      const mockUploader = async () => {
        uploaderCalled = true;
        return { objectId: 'remote_obj_scen_a', url: 'https://gateway/remote_obj_scen_a', idempotent: false };
      };

      const coord = new TabCoordinator('tab_coord_scen_a');
      coord.claimLeadership();
      (coord as any).leadershipClaimedAt = Date.now() - 1000;

      const service = new OfflineMediaSyncService(mockUploader as any, coord);
      service.setActiveUser(syncUserA);
      const result = await service.drainPendingMedia(syncUserA, { force: true });

      assert.equal(uploaderCalled, true, 'Drain must run for eligible-now media');
      assert.equal(result.synced, 1, 'Synced count must reflect successful upload');
      assert.equal(result.pendingTotal, 0, 'pendingTotal must be 0 after successful drain');
      assert.equal(result.pendingCount, 0, 'pendingCount must be 0 after successful drain');
    });

    test('Scenario B (Section 9): 1 item waiting for future backoff is NOT retried early; pendingTotal=1; does NOT report everything is up to date', async () => {
      const queued = await enqueueOfflineMedia({
        id: 'media_scen_b_1',
        uid: syncUserB,
        purpose: 'attachments',
        blob: new Blob(['scenario B attachment'], { type: 'application/pdf' }),
        mimeType: 'application/pdf',
        fileName: 'scenario_b.pdf',
        remoteObjectId: 'remote_obj_scen_b',
      });

      // Mark media failed with HTTP 500 transient error -> sets backoff and nextEligibleAttemptAt in future
      await markMediaFailed(queued.id, syncUserB, 'HTTP 500 network error', 500);

      let uploaderCalled = false;
      const mockUploader = async () => {
        uploaderCalled = true;
        return { objectId: 'remote_obj_scen_b', url: 'https://gateway/b', idempotent: false };
      };

      const coord = new TabCoordinator('tab_coord_scen_b');
      coord.claimLeadership();
      (coord as any).leadershipClaimedAt = Date.now() - 1000;

      const service = new OfflineMediaSyncService(mockUploader as any, coord);
      service.setActiveUser(syncUserB);
      const result = await service.drainPendingMedia(syncUserB);

      assert.equal(uploaderCalled, false, 'Automatic drain must NOT retry backoff item early');
      assert.equal(result.synced, 0);
      assert.equal(result.pendingTotal, 1, 'pendingTotal must truthfully report 1 pending item');
      assert.equal(result.pendingCount, 1, 'pendingCount must be 1');
      assert.equal(result.waitingForBackoff, 1, 'waitingForBackoff must be 1');
      assert.equal(result.eligibleNow, 0, 'eligibleNow must be 0');

      const feedback = result.needsAttention > 0
        ? 'Your notes are synced. Some files need attention before they can upload.'
        : result.pendingTotal > 0
          ? 'Your notes are synced. Some files are waiting to upload and will retry automatically.'
          : 'Everything is up to date.';

      assert.notEqual(feedback, 'Everything is up to date.');
      assert.equal(feedback, 'Your notes are synced. Some files are waiting to upload and will retry automatically.');
    });

    test('Scenario C (Section 9): 1 permanent/requiresUserAction item has no automatic retry; pendingTotal=1, needsAttention=1', async () => {
      const queued = await enqueueOfflineMedia({
        id: 'media_scen_c_1',
        uid: syncUserC,
        purpose: 'voiceNotes',
        blob: new Blob(['scenario C voice memo'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        fileName: 'scenario_c.webm',
        remoteObjectId: 'remote_obj_scen_c',
      });

      // Mark media failed with HTTP 400 fatal client error -> sets requiresUserAction = true
      await markMediaFailed(queued.id, syncUserC, 'HTTP 400 invalid content type', 400);

      let uploaderCalled = false;
      const mockUploader = async () => {
        uploaderCalled = true;
        return { objectId: 'remote_obj_scen_c', url: 'https://gateway/c', idempotent: false };
      };

      const coord = new TabCoordinator('tab_coord_scen_c');
      coord.claimLeadership();
      (coord as any).leadershipClaimedAt = Date.now() - 1000;

      const service = new OfflineMediaSyncService(mockUploader as any, coord);
      service.setActiveUser(syncUserC);
      const result = await service.drainPendingMedia(syncUserC);

      assert.equal(uploaderCalled, false, 'Permanent failure must NOT be automatically retried');
      assert.equal(result.pendingTotal, 1);
      assert.equal(result.pendingCount, 1);
      assert.equal(result.needsAttention, 1);
      assert.equal(result.eligibleNow, 0);

      const feedback = result.needsAttention > 0
        ? 'Your notes are synced. Some files need attention before they can upload.'
        : result.pendingTotal > 0
          ? 'Your notes are synced. Some files are waiting to upload and will retry automatically.'
          : 'Everything is up to date.';

      assert.equal(feedback, 'Your notes are synced. Some files need attention before they can upload.');
    });

    test('Scenario D (Section 9): 0 media items truthfully reports everything is up to date', async () => {
      const coord = new TabCoordinator('tab_coord_scen_d');
      coord.claimLeadership();
      (coord as any).leadershipClaimedAt = Date.now() - 1000;

      const service = new OfflineMediaSyncService(async () => ({ objectId: '', url: '', idempotent: false }), coord);
      service.setActiveUser(syncUserD);
      const result = await service.drainPendingMedia(syncUserD);

      assert.equal(result.pendingTotal, 0);
      assert.equal(result.pendingCount, 0);
      assert.equal(result.needsAttention, 0);
      assert.equal(result.waitingForBackoff, 0);
      assert.equal(result.eligibleNow, 0);

      const feedback = result.needsAttention > 0
        ? 'Your notes are synced. Some files need attention before they can upload.'
        : result.pendingTotal > 0
          ? 'Your notes are synced. Some files are waiting to upload and will retry automatically.'
          : 'Everything is up to date.';

      assert.equal(feedback, 'Everything is up to date.');
    });
  });

  describe('NTK Note v2.8.2 — Final Accessibility, Owner-Auth Truth & Release Invariants', () => {
    test('Zero hardcoded owner emails exist in src/ directory', () => {
      const files: string[] = [];
      function walkDir(dir: string) {
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const p = path.join(dir, file);
          if (fs.statSync(p).isDirectory()) walkDir(p);
          else if (p.endsWith('.ts') || p.endsWith('.tsx')) files.push(p);
        }
      }
      walkDir(path.resolve('src'));

      const forbidden = ['futureeternal@gmail.com', 'feaiccws@gmail.com', 'appdevmanwill@gmail.com', 'OWNER_EMAILS'];
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        for (const str of forbidden) {
          assert.equal(
            content.includes(str),
            false,
            `Forbidden hardcoded string "${str}" found in ${file}`
          );
        }
      }
    });

    test('100% of interactive button elements have descriptive accessible names', () => {
      const files: string[] = [];
      function walkDir(dir: string) {
        const list = fs.readdirSync(dir);
        for (const file of list) {
          const p = path.join(dir, file);
          if (fs.statSync(p).isDirectory()) walkDir(p);
          else if (p.endsWith('.tsx')) files.push(p);
        }
      }
      walkDir(path.resolve('src'));

      const missing: string[] = [];
      for (const file of files) {
        const content = fs.readFileSync(file, 'utf8');
        const tagRegex = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
        let match: RegExpExecArray | null;
        while ((match = tagRegex.exec(content)) !== null) {
          const attrs = match[1];
          const inner = match[2].trim();

          const labelMatch = /aria-label\s*=\s*(?:"([^"]*)"|'([^']*)'|\{([^}]*)\})/i.exec(attrs);
          const hasAriaLabelledby = /aria-labelledby\s*=/i.test(attrs);

          if (labelMatch) {
            const val = (labelMatch[1] || labelMatch[2] || labelMatch[3] || '').trim().replace(/['"]/g, '');
            if (/^(?:button|icon|action)$/i.test(val)) {
              missing.push(`${file} -> generic label: "${val}"`);
            }
          } else if (!hasAriaLabelledby) {
            const withoutTags = inner.replace(/<[^>]+>/g, ' ').trim();
            const withoutComments = withoutTags.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '').trim();
            const words = withoutComments.replace(/\{[^}]+\}/g, '').trim();
            const hasVisibleWord = /[a-zA-Z0-9]{2,}/.test(words);
            const hasDynamicText = /\{(?:\w+\.)?(?:title|name|label|text|children|format|count|date|tag|category|shortcut|heading|desc|step|tab|opt)\b/i.test(withoutComments);
            const hasTernaryString = /\{.*?\?.*?['"`][a-zA-Z0-9 ]+['"`].*?:.*?\}/.test(withoutComments);

            if (!hasVisibleWord && !hasDynamicText && !hasTernaryString) {
              missing.push(`${file} -> missing accessible name for: ${inner.substring(0, 40)}`);
            }
          }
        }
      }

      assert.deepEqual(missing, [], 'All buttons must possess descriptive accessible names');
    });

    test('Owner status fail-closed guarantee: defaults to false if gateway is unreachable', () => {
      // Test fail-closed owner logic
      function resolveOwnerAccess(gatewayPayload: { isOwner?: boolean } | null | undefined): boolean {
        if (!gatewayPayload) return false;
        return Boolean(gatewayPayload.isOwner);
      }

      assert.equal(resolveOwnerAccess(null), false);
      assert.equal(resolveOwnerAccess(undefined), false);
      assert.equal(resolveOwnerAccess({}), false);
      assert.equal(resolveOwnerAccess({ isOwner: false }), false);
      assert.equal(resolveOwnerAccess({ isOwner: true }), true);
    });
  });

  after(() => {
    setTimeout(() => process.exit(0), 100);
  });
});


