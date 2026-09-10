import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  addDoc,
  query,
  where,
  limit,
  getDocs,
  serverTimestamp,
  deleteDoc,
} from 'firebase/firestore';
import { commitQueuedNoteSafely } from '../src/utils/noteSyncTransaction.ts';
import type { Note, SyncQueueItem } from '../src/types/index.ts';

const PROJECT_ID = 'ntk-note-rules-test';

describe('Firestore Security Rules Unit Tests', () => {
  let testEnv: RulesTestEnvironment;

  before(async () => {
    const rulesPath = resolve(process.cwd(), 'firestore.rules');
    const rules = readFileSync(rulesPath, 'utf8');

    testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        rules,
        host: '127.0.0.1',
        port: Number(process.env.FIRESTORE_EMULATOR_PORT || 8088),
      },
    });
  });

  after(async () => {
    if (testEnv) {
      await testEnv.cleanup();
    }
  });

  beforeEach(async () => {
    if (testEnv) {
      await testEnv.clearFirestore();
    }
  });

  test('User can read and write to their own user subcollection', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com' }).firestore();
    const aliceDoc = doc(aliceDb, 'users/alice_uid/notes/note_1');

    await assertSucceeds(
      setDoc(aliceDoc, {
        id: 'note_1',
        title: 'Alice Private Note',
        ownerId: 'alice_uid',
      })
    );

    const snapshot = await assertSucceeds(getDoc(aliceDoc));
    assert.equal(snapshot.data()?.title, 'Alice Private Note');
  });

  test('User cannot read or write to another user private subcollection', async () => {
    // Setup Alice's note with admin privileges
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'users/alice_uid/notes/note_1'), {
        id: 'note_1',
        title: 'Alice Private Note',
        ownerId: 'alice_uid',
      });
    });

    // Bob attempts to read and write Alice's note
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com' }).firestore();
    const targetDoc = doc(bobDb, 'users/alice_uid/notes/note_1');

    await assertFails(getDoc(targetDoc));
    await assertFails(
      setDoc(targetDoc, {
        id: 'note_1',
        title: 'Tampered by Bob',
      })
    );
  });

  test('Comment authorization: Owner, editor, and commenter can comment; Viewer is DENIED', async () => {
    // Setup shared note with distinct roles
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'shared_notes/sn_1'), {
        id: 'sn_1',
        title: 'Project Roadmap',
        ownerId: 'alice_uid',
        sharedWith: ['editor@example.com', 'commenter@example.com', 'viewer@example.com'],
        editors: ['editor@example.com'],
        commenters: ['commenter@example.com'],
        viewers: ['viewer@example.com'],
        isShared: true,
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const editorDb = testEnv.authenticatedContext('editor_uid', { email: 'editor@example.com', email_verified: true }).firestore();
    const commenterDb = testEnv.authenticatedContext('commenter_uid', { email: 'commenter@example.com', email_verified: true }).firestore();
    const viewerDb = testEnv.authenticatedContext('viewer_uid', { email: 'viewer@example.com', email_verified: true }).firestore();
    const outsiderDb = testEnv.authenticatedContext('outsider_uid', { email: 'outsider@example.com', email_verified: true }).firestore();

    const participants = ['alice@example.com', 'editor@example.com', 'commenter@example.com', 'viewer@example.com'];

    // 1. Owner comment -> ALLOW
    await assertSucceeds(
      setDoc(doc(aliceDb, 'note_comments/comm_alice'), {
        noteId: 'sn_1',
        authorEmail: 'alice@example.com',
        participants,
        body: 'Owner comment here',
        createdAt: '2026-08-28T10:00:00Z',
      })
    );

    // 2. Editor comment -> ALLOW
    await assertSucceeds(
      setDoc(doc(editorDb, 'note_comments/comm_editor'), {
        noteId: 'sn_1',
        authorEmail: 'editor@example.com',
        participants,
        body: 'Editor feedback',
        createdAt: '2026-08-28T10:01:00Z',
      })
    );

    // 3. Commenter comment -> ALLOW
    await assertSucceeds(
      setDoc(doc(commenterDb, 'note_comments/comm_commenter'), {
        noteId: 'sn_1',
        authorEmail: 'commenter@example.com',
        participants,
        body: 'Commenter feedback',
        createdAt: '2026-08-28T10:02:00Z',
      })
    );

    // 4. Viewer comment -> DENY (Crucial security invariant: Viewers cannot create comments)
    await assertFails(
      setDoc(doc(viewerDb, 'note_comments/comm_viewer'), {
        noteId: 'sn_1',
        authorEmail: 'viewer@example.com',
        participants,
        body: 'Unauthorized viewer comment',
        createdAt: '2026-08-28T10:03:00Z',
      })
    );

    // 5. Outsider comment -> DENY
    await assertFails(
      setDoc(doc(outsiderDb, 'note_comments/comm_outsider'), {
        noteId: 'sn_1',
        authorEmail: 'outsider@example.com',
        participants,
        body: 'Outsider comment',
        createdAt: '2026-08-28T10:04:00Z',
      })
    );
  });

  test('Comment updates cannot alter immutable fields (noteId, authorEmail, createdAt)', async () => {
    // Seed initial comment
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'shared_notes/sn_2'), {
        id: 'sn_2',
        title: 'Sprint Backlog',
        ownerId: 'alice_uid',
        sharedWith: ['editor@example.com'],
        editors: ['editor@example.com'],
        isShared: true,
      });
      await setDoc(doc(adminDb, 'note_comments/comm_valid'), {
        noteId: 'sn_2',
        authorEmail: 'editor@example.com',
        participants: ['alice@example.com', 'editor@example.com'],
        body: 'Initial text',
        createdAt: '2026-08-28T11:00:00Z',
      });
    });

    const editorDb = testEnv.authenticatedContext('editor_uid', { email: 'editor@example.com', email_verified: true }).firestore();
    const commDoc = doc(editorDb, 'note_comments/comm_valid');

    // Editing body content is allowed
    await assertSucceeds(
      updateDoc(commDoc, {
        body: 'Updated text by author',
      })
    );

    // Tampering with noteId or authorEmail is DENIED
    await assertFails(
      updateDoc(commDoc, {
        noteId: 'sn_hijacked',
      })
    );
  });

  test('Participant Injection Prevention & Revocation: Outsiders cannot read comments via fake participants array', async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      // Alice owns shared note, shared ONLY with bob
      await setDoc(doc(adminDb, 'shared_notes/sn_private'), {
        id: 'sn_private',
        title: 'Private Discussion',
        ownerId: 'alice_uid',
        sharedWith: ['bob@example.com'],
        editors: ['bob@example.com'],
        isShared: true,
      });

      // A comment that malicious outsider tries to claim they are in participants of
      await setDoc(doc(adminDb, 'note_comments/comm_secret'), {
        noteId: 'sn_private',
        authorEmail: 'alice@example.com',
        participants: ['alice@example.com', 'bob@example.com', 'eve@example.com'], // Eve injected in participants array
        body: 'Confidential corporate strategy',
        createdAt: '2026-08-28T12:00:00Z',
      });
    });

    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();
    const eveDb = testEnv.authenticatedContext('eve_uid', { email: 'eve@example.com', email_verified: true }).firestore();

    // Bob is authorized on shared_notes/sn_private -> ALLOW read
    await assertSucceeds(getDoc(doc(bobDb, 'note_comments/comm_secret')));

    // Eve is NOT on shared_notes/sn_private, so even with participant array injection -> DENY read
    await assertFails(getDoc(doc(eveDb, 'note_comments/comm_secret')));
  });

  test('Shared Note Sharing Protection: Editors cannot escalate permissions or alter sharing fields', async () => {
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'shared_notes/sn_locked'), {
        id: 'sn_locked',
        title: 'Document',
        content: 'Original content',
        ownerId: 'alice_uid',
        sharedWith: ['editor@example.com'],
        editors: ['editor@example.com'],
        isShared: true,
        isPublished: false,
      });
    });

    const editorDb = testEnv.authenticatedContext('editor_uid', { email: 'editor@example.com', email_verified: true }).firestore();
    const noteRef = doc(editorDb, 'shared_notes/sn_locked');

    // Editor updating content and title -> ALLOW
    await assertSucceeds(
      updateDoc(noteRef, {
        title: 'Document v2',
        content: 'New collaborated text',
        updatedAt: '2026-08-28T13:00:00Z',
      })
    );

    // Editor attempting to hijack ownerId -> DENY
    await assertFails(
      updateDoc(noteRef, {
        ownerId: 'editor_uid',
      })
    );

    // Editor attempting to publish or modify sharedWith -> DENY
    await assertFails(
      updateDoc(noteRef, {
        isPublished: true,
      })
    );
  });

  test('Direct Chat Security: Only participants can read, create, and list direct chats', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();
    const eveDb = testEnv.authenticatedContext('eve_uid', { email: 'eve@example.com', email_verified: true }).firestore();

    const chatId = 'alice_uid_bob_uid';
    const chatRef = doc(aliceDb, `direct_chats/${chatId}`);

    // Alice creates 1-to-1 chat with Bob -> ALLOW
    await assertSucceeds(
      setDoc(chatRef, {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'alice_uid',
      })
    );

    // Alice and Bob can read -> ALLOW
    await assertSucceeds(getDoc(doc(aliceDb, `direct_chats/${chatId}`)));
    await assertSucceeds(getDoc(doc(bobDb, `direct_chats/${chatId}`)));

    // Non-participant Eve CANNOT read -> DENY
    await assertFails(getDoc(doc(eveDb, `direct_chats/${chatId}`)));

    // Eve cannot create a chat she is not part of -> DENY
    await assertFails(
      setDoc(doc(eveDb, 'direct_chats/spoofed_chat'), {
        participantUids: ['alice_uid', 'bob_uid'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'eve_uid',
      })
    );

    // Participant set is immutable (Alice cannot add Eve to this direct chat) -> DENY
    await assertFails(
      updateDoc(chatRef, {
        participantUids: ['alice_uid', 'bob_uid', 'eve_uid'],
      })
    );
  });

  test('Direct Messages Security: Participant authorization, max length, immutability, and blocking', async () => {
    // Setup active chat
    const chatId = 'alice_uid_bob_uid';
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();
    const eveDb = testEnv.authenticatedContext('eve_uid', { email: 'eve@example.com', email_verified: true }).firestore();

    const msgRef = doc(aliceDb, `direct_chats/${chatId}/messages/msg_1`);

    // Alice sends legitimate message -> ALLOW
    await assertSucceeds(
      setDoc(msgRef, {
        senderUid: 'alice_uid',
        text: 'Hello Bob!',
        createdAt: serverTimestamp(),
        type: 'text',
      })
    );

    // Alice attempts to forge senderUid = bob_uid -> DENY
    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/msg_forged`), {
        senderUid: 'bob_uid',
        text: 'I am Bob (forged)',
        createdAt: serverTimestamp(),
        type: 'text',
      })
    );

    // Non-participant Eve cannot send or read messages -> DENY
    await assertFails(
      setDoc(doc(eveDb, `direct_chats/${chatId}/messages/msg_eve`), {
        senderUid: 'eve_uid',
        text: 'I am eavesdropping',
        createdAt: serverTimestamp(),
        type: 'text',
      })
    );
    await assertFails(getDoc(doc(eveDb, `direct_chats/${chatId}/messages/msg_1`)));

    // Message length cap: 4,001 characters -> DENY
    const oversizedText = 'a'.repeat(4001);
    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/msg_huge`), {
        senderUid: 'alice_uid',
        text: oversizedText,
        createdAt: serverTimestamp(),
        type: 'text',
      })
    );

    // Messages are immutable (cannot update or delete) -> DENY
    await assertFails(
      updateDoc(msgRef, {
        text: 'Tampered message',
      })
    );

    // When chat is blocked, new messages are rejected
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await updateDoc(doc(adminDb, `direct_chats/${chatId}`), {
        status: 'blocked',
        blockedByUids: ['bob_uid'],
      });
    });

    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/msg_blocked`), {
        senderUid: 'alice_uid',
        text: 'Trying to talk while blocked',
        createdAt: serverTimestamp(),
        type: 'text',
      })
    );
  });

  test('AI Threads & Turns Privacy: Strictly private to authenticated user account', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();

    const threadRef = doc(aliceDb, 'users/alice_uid/ai_threads/thread_1');
    const turnRef = doc(aliceDb, 'users/alice_uid/ai_threads/thread_1/turns/turn_1');

    // Alice creates thread and completed turn -> ALLOW
    await assertSucceeds(
      setDoc(threadRef, {
        title: 'Project Planning',
        createdAt: '2026-09-05T12:00:00Z',
        updatedAt: '2026-09-05T12:00:00Z',
        preview: 'Plan a wedding',
      })
    );

    await assertSucceeds(
      setDoc(turnRef, {
        userText: 'Help me plan a wedding',
        assistantText: 'Here is a 5-step wedding checklist...',
        createdAt: '2026-09-05T12:00:00Z',
        status: 'completed',
      })
    );

    // Bob cannot read Alice AI threads or turns -> DENY
    await assertFails(getDoc(doc(bobDb, 'users/alice_uid/ai_threads/thread_1')));
    await assertFails(getDoc(doc(bobDb, 'users/alice_uid/ai_threads/thread_1/turns/turn_1')));
  });

  test('User Directory Discovery: Only safe fields exposed, users cannot tamper with other records', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();

    // Alice registers directory entry with safe fields -> ALLOW
    const aliceDirRef = doc(aliceDb, 'users_directory/alice@example.com');
    await assertSucceeds(
      setDoc(aliceDirRef, {
        name: 'Alice Cooper',
        email: 'alice@example.com',
        initials: 'AC',
        uid: 'alice_uid',
        discoverable: true,
        searchPrefixes: ['ali', 'alic', 'alice'],
        updatedAt: '2026-09-05T12:00:00Z',
      })
    );

    // Bob can read Alice directory entry for discovery -> ALLOW
    await assertSucceeds(getDoc(doc(bobDb, 'users_directory/alice@example.com')));

    // Bob attempts to modify Alice directory entry -> DENY
    await assertFails(
      setDoc(doc(bobDb, 'users_directory/alice@example.com'), {
        name: 'Hacked by Bob',
        email: 'alice@example.com',
        initials: 'HB',
        searchPrefixes: ['hac'],
        updatedAt: '2026-09-05T12:01:00Z',
      })
    );

    // Unauthenticated user cannot read directory -> DENY
    const unauthDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(unauthDb, 'users_directory/alice@example.com')));
  });

  test('Section 10: direct_chats query & list privacy — nonparticipants cannot list, participant query requires array-contains', async () => {
    // Seed an Alice & Bob direct chat
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, 'direct_chats/alice_uid_bob_uid'), {
        participantUids: ['alice_uid', 'bob_uid'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const eveDb = testEnv.authenticatedContext('eve_uid', { email: 'eve@example.com', email_verified: true }).firestore();

    // Eve (nonparticipant) tries to list/query direct_chats without participant filter -> DENIED
    await assertFails(getDocs(query(collection(eveDb, 'direct_chats'), limit(10))));

    // Eve queries with her own participant filter -> ALLOWED (returns empty result safely)
    await assertSucceeds(
      getDocs(
        query(
          collection(eveDb, 'direct_chats'),
          where('participantUids', 'array-contains', 'eve_uid'),
          limit(10)
        )
      )
    );

    // Alice queries direct_chats with her own participant filter -> ALLOWED
    const aliceQuerySnap = await assertSucceeds(
      getDocs(
        query(
          collection(aliceDb, 'direct_chats'),
          where('participantUids', 'array-contains', 'alice_uid'),
          limit(10)
        )
      )
    );
    assert.equal(aliceQuerySnap.size, 1);

    // Alice tries to query without participant filter -> DENIED (rules enforce client query bounds)
    await assertFails(getDocs(query(collection(aliceDb, 'direct_chats'), limit(10))));
  });

  test('Section 11: Direct message list limit bypass prevention', async () => {
    const chatId = 'alice_uid_bob_uid';
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
      });
      await setDoc(doc(adminDb, `direct_chats/${chatId}/messages/m1`), {
        senderUid: 'alice_uid',
        text: 'Message 1',
        createdAt: '2026-09-05T12:01:00Z',
        type: 'text',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const eveDb = testEnv.authenticatedContext('eve_uid', { email: 'eve@example.com', email_verified: true }).firestore();

    // 1. Participant GET = allowed
    await assertSucceeds(getDoc(doc(aliceDb, `direct_chats/${chatId}/messages/m1`)));

    // 2. Participant LIST with limit 40 = allowed
    await assertSucceeds(
      getDocs(query(collection(aliceDb, `direct_chats/${chatId}/messages`), limit(40)))
    );

    // 3. Participant LIST without limit = denied
    await assertFails(getDocs(collection(aliceDb, `direct_chats/${chatId}/messages`)));

    // 4. Participant LIST with limit > 50 = denied
    await assertFails(
      getDocs(query(collection(aliceDb, `direct_chats/${chatId}/messages`), limit(51)))
    );

    // 5. Nonparticipant = denied
    await assertFails(
      getDocs(query(collection(eveDb, `direct_chats/${chatId}/messages`), limit(40)))
    );
  });

  test('Section 12 & 13: Strict direct chat update rules & message request state transitions', async () => {
    const chatId = 'alice_uid_bob_uid';
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        participantData: {
          alice_uid: { name: 'Alice', email: 'alice@example.com' },
          bob_uid: { name: 'Bob', email: 'bob@example.com' },
        },
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'pending',
        requestedByUid: 'alice_uid',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();
    const chatRefAlice = doc(aliceDb, `direct_chats/${chatId}`);
    const chatRefBob = doc(bobDb, `direct_chats/${chatId}`);

    // Requester (Alice) CANNOT accept her own request -> DENIED
    await assertFails(
      updateDoc(chatRefAlice, {
        status: 'active',
        acceptedAt: serverTimestamp(),
      })
    );

    // Requester (Alice) CANNOT decline her own request -> DENIED
    await assertFails(
      updateDoc(chatRefAlice, {
        status: 'declined',
        declinedAt: serverTimestamp(),
      })
    );

    // Participants cannot tamper with immutable fields (requestedByUid, createdAt, participantData)
    await assertFails(
      updateDoc(chatRefAlice, {
        requestedByUid: 'bob_uid',
      })
    );
    await assertFails(
      updateDoc(chatRefAlice, {
        createdAt: '2020-01-01T00:00:00Z',
      })
    );
    await assertFails(
      updateDoc(chatRefAlice, {
        participantData: { alice_uid: { name: 'Hacked' } },
      })
    );

    // Intended recipient (Bob) accepts request -> ALLOWED
    await assertSucceeds(
      updateDoc(chatRefBob, {
        status: 'active',
        acceptedAt: serverTimestamp(),
      })
    );

    // After chat is active, arbitrary status transition to 'declined' is DENIED
    await assertFails(
      updateDoc(chatRefBob, {
        status: 'declined',
      })
    );
  });

  test('Section 14: Initiator-based blocking semantics & block immutability', async () => {
    const chatId = 'alice_uid_bob_uid';
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();
    const chatRefBob = doc(bobDb, `direct_chats/${chatId}`);
    const chatRefAlice = doc(aliceDb, `direct_chats/${chatId}`);

    // Bob blocks Alice: status='blocked', blockedByUids=['bob_uid'] -> ALLOWED
    await assertSucceeds(
      updateDoc(chatRefBob, {
        status: 'blocked',
        blockedByUids: ['bob_uid'],
        blockedAt: serverTimestamp(),
      })
    );

    // Alice also blocks: adds her own UID to blockedByUids -> ALLOWED
    await assertSucceeds(
      updateDoc(chatRefAlice, {
        status: 'blocked',
        blockedByUids: ['bob_uid', 'alice_uid'],
        blockedAt: serverTimestamp(),
      })
    );

    // Alice attempts to remove Bob from blockedByUids -> DENIED
    await assertFails(
      updateDoc(chatRefAlice, {
        status: 'blocked',
        blockedByUids: ['alice_uid'],
        blockedAt: serverTimestamp(),
      })
    );

    // Arbitrary unblock back to 'active' -> DENIED
    await assertFails(
      updateDoc(chatRefAlice, {
        status: 'active',
      })
    );
  });

  test('Section 15 & 16: Direct chat creation & message document field validation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();

    // 1. Cannot create chat with oneself -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, 'direct_chats/self_chat'), {
        participantUids: ['alice_uid', 'alice_uid'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'alice_uid',
      })
    );

    // 2. Cannot create chat with 3 participants -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, 'direct_chats/group_chat'), {
        participantUids: ['alice_uid', 'bob_uid', 'charlie_uid'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'alice_uid',
      })
    );

    // Setup active chat
    const chatId = 'alice_uid_bob_uid';
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
      });
    });

    // 3. Message with unexpected extra fields -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/msg_bad_fields`), {
        senderUid: 'alice_uid',
        text: 'Testing extra fields',
        type: 'text',
        createdAt: serverTimestamp(),
        isSuperUser: true,
      })
    );

    // 4. Message with non-text type -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/msg_bad_type`), {
        senderUid: 'alice_uid',
        text: 'Testing type',
        type: 'attachment',
        createdAt: serverTimestamp(),
      })
    );

    // 5. Valid message -> ALLOWED
    await assertSucceeds(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/msg_clean`), {
        senderUid: 'alice_uid',
        text: 'Strict clean text message',
        type: 'text',
        createdAt: serverTimestamp(),
      })
    );
  });

  test('Section 20: Server-enforced directory discoverability', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();

    const aliceDirRef = doc(aliceDb, 'users_directory/alice@example.com');
    const bobDirRefOnAlice = doc(bobDb, 'users_directory/alice@example.com');

    // Alice creates directory record with discoverable = false
    await assertSucceeds(
      setDoc(aliceDirRef, {
        name: 'Alice Private',
        email: 'alice@example.com',
        initials: 'AP',
        uid: 'alice_uid',
        discoverable: false,
        searchPrefixes: ['ali', 'alic'],
        updatedAt: '2026-09-05T12:00:00Z',
      })
    );

    // 1. Bob direct GET on Alice (discoverable: false) -> DENIED
    await assertFails(getDoc(bobDirRefOnAlice));

    // 2. Alice direct GET on own record -> ALLOWED
    await assertSucceeds(getDoc(aliceDirRef));

    // 3. Bob queries discoverable users -> ALLOWED, returns zero docs (Alice excluded)
    const qSnap = await assertSucceeds(
      getDocs(
        query(
          collection(bobDb, 'users_directory'),
          where('discoverable', '==', true),
          limit(10)
        )
      )
    );
    assert.equal(qSnap.size, 0);

    // 4. Alice updates discoverable = true -> ALLOWED
    await assertSucceeds(
      updateDoc(aliceDirRef, {
        discoverable: true,
      })
    );

    // 5. Bob direct GET on Alice (now discoverable) -> ALLOWED
    const snapAfter = await assertSucceeds(getDoc(bobDirRefOnAlice));
    assert.equal(snapAfter.data()?.name, 'Alice Private');
  });

  test('Section 26: Chat creation MUST be pending; active-at-create and unknown fields are DENIED', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();

    // 1. Active-at-create bypass attempt -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, 'direct_chats/chat_active_attempt'), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'active',
        requestedByUid: 'alice_uid',
      })
    );

    // 2. Extra unknown field (not in strict schema) -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, 'direct_chats/chat_unknown_field'), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'alice_uid',
        maliciousAdminFlag: true,
      })
    );

    // 3. Valid pending chat with serverTimestamp -> ALLOWED
    await assertSucceeds(
      setDoc(doc(aliceDb, 'direct_chats/chat_valid_pending'), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'alice_uid',
        lastReadAtByUid: {
          alice_uid: serverTimestamp(),
        },
      })
    );
  });

  test('Section 26: Identity spoofing protections on chat creation', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();

    // 1. Alice claims requestedByUid is Bob -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, 'direct_chats/chat_spoof_requester'), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'bob_uid',
      })
    );

    // 2. Alice claims a fake email in participantData for herself -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, 'direct_chats/chat_spoof_email'), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        participantData: {
          alice_uid: { email: 'ceo@example.com' },
          bob_uid: { email: 'bob@example.com' },
        },
        createdAt: serverTimestamp(),
        lastMessageAt: serverTimestamp(),
        status: 'pending',
        requestedByUid: 'alice_uid',
      })
    );
  });

  test('Section 26: Client future/forged timestamps are DENIED', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const chatId = 'alice_uid_bob_future_test';

    // Setup active chat via admin
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
      });
    });

    // 1. Chat create with year 2099 ISO string -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, 'direct_chats/chat_future_2099'), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: '2099-01-01T00:00:00Z',
        lastMessageAt: '2099-01-01T00:00:00Z',
        status: 'pending',
        requestedByUid: 'alice_uid',
      })
    );

    // 2. Message create with year 2099 ISO string -> DENIED
    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/m_future_2099`), {
        senderUid: 'alice_uid',
        text: 'Time-travel message',
        type: 'text',
        createdAt: '2099-01-01T00:00:00Z',
      })
    );

    // 3. Message create with serverTimestamp() -> ALLOWED
    await assertSucceeds(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/m_valid_server_time`), {
        senderUid: 'alice_uid',
        text: 'Legitimate message with server time',
        type: 'text',
        createdAt: serverTimestamp(),
      })
    );
  });

  test('Section 26: Read-state map isolation (Alice cannot modify Bob read state)', async () => {
    const chatId = 'alice_uid_bob_read_iso';
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
        lastReadAtByUid: {
          alice_uid: '2026-09-05T12:00:00Z',
          bob_uid: '2026-09-05T12:00:00Z',
        },
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const chatRefAlice = doc(aliceDb, `direct_chats/${chatId}`);

    // 1. Alice modifies Bob's read-state entry -> DENIED
    await assertFails(
      updateDoc(chatRefAlice, {
        'lastReadAtByUid.bob_uid': serverTimestamp(),
      })
    );

    // 2. Alice modifies both Alice and Bob entries -> DENIED
    await assertFails(
      updateDoc(chatRefAlice, {
        lastReadAtByUid: {
          alice_uid: serverTimestamp(),
          bob_uid: serverTimestamp(),
        },
      })
    );

    // 3. Alice modifies ONLY Alice's read-state entry -> ALLOWED
    await assertSucceeds(
      updateDoc(chatRefAlice, {
        'lastReadAtByUid.alice_uid': serverTimestamp(),
      })
    );
  });

  test('Section 26: Message summary update hardening and blocked chat sending prohibition', async () => {
    const chatId = 'alice_uid_bob_summary_test';
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await setDoc(doc(adminDb, `direct_chats/${chatId}`), {
        participantUids: ['alice_uid', 'bob_uid'],
        participantEmails: ['alice@example.com', 'bob@example.com'],
        createdAt: '2026-09-05T12:00:00Z',
        lastMessageAt: '2026-09-05T12:00:00Z',
        status: 'active',
        requestedByUid: 'alice_uid',
        lastReadAtByUid: {
          alice_uid: '2026-09-05T12:00:00Z',
          bob_uid: '2026-09-05T12:00:00Z',
        },
      });
    });

    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const chatRefAlice = doc(aliceDb, `direct_chats/${chatId}`);

    // 1. Summary with forged senderUid (Bob) -> DENIED
    await assertFails(
      updateDoc(chatRefAlice, {
        lastMessageSenderUid: 'bob_uid',
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: 'Hello',
        'lastReadAtByUid.alice_uid': serverTimestamp(),
      })
    );

    // 2. Summary with preview exceeding 100 characters -> DENIED
    const tooLongPreview = 'A'.repeat(101);
    await assertFails(
      updateDoc(chatRefAlice, {
        lastMessageSenderUid: 'alice_uid',
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: tooLongPreview,
        'lastReadAtByUid.alice_uid': serverTimestamp(),
      })
    );

    // 3. Valid message summary update -> ALLOWED
    await assertSucceeds(
      updateDoc(chatRefAlice, {
        lastMessageSenderUid: 'alice_uid',
        lastMessageAt: serverTimestamp(),
        lastMessagePreview: 'Valid preview',
        'lastReadAtByUid.alice_uid': serverTimestamp(),
      })
    );

    // 4. Block the chat, verify new messages are rejected
    await testEnv.withSecurityRulesDisabled(async (adminContext) => {
      const adminDb = adminContext.firestore();
      await updateDoc(doc(adminDb, `direct_chats/${chatId}`), {
        status: 'blocked',
        blockedByUids: ['bob_uid'],
      });
    });

    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/m_after_block`), {
        senderUid: 'alice_uid',
        text: 'Should not send while blocked',
        type: 'text',
        createdAt: serverTimestamp(),
      })
    );
  });

  test('Section 34: Safe Create-First Chat Architecture, Pending Message Denial & Request Preview', async () => {
    const chatId = 'alice_uid_bob_uid_create_first';
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();
    const eveDb = testEnv.authenticatedContext('eve_uid', { email: 'eve@example.com', email_verified: true }).firestore();

    const chatRefAlice = doc(aliceDb, `direct_chats/${chatId}`);
    const chatRefBob = doc(bobDb, `direct_chats/${chatId}`);
    const chatRefEve = doc(eveDb, `direct_chats/${chatId}`);

    // A. Pre-read of non-existent chat fails with PERMISSION_DENIED under hardened GET rule
    await assertFails(getDoc(chatRefAlice));

    // B. Direct create-first with valid pending state and requestPreview succeeds
    const newChatData = {
      participantUids: ['alice_uid', 'bob_uid'],
      participantEmails: ['alice@example.com', 'bob@example.com'],
      status: 'pending',
      requestedByUid: 'alice_uid',
      requestPreview: 'Hello Bob, would love to collaborate on the project.',
      createdAt: serverTimestamp(),
      lastMessageAt: serverTimestamp(),
      lastReadAtByUid: {
        alice_uid: serverTimestamp(),
      },
    };
    await assertSucceeds(setDoc(chatRefAlice, newChatData));

    // C. Non-participant (Eve) get is denied without existence disclosure
    await assertFails(getDoc(chatRefEve));

    // D. Legitimate participant (Bob & Alice) get succeeds
    const aliceSnap = await assertSucceeds(getDoc(chatRefAlice));
    assert.equal(aliceSnap.data()?.status, 'pending');
    assert.equal(aliceSnap.data()?.requestPreview, 'Hello Bob, would love to collaborate on the project.');

    // E. Overwrite attempt: Calling setDoc on existing chat fails under strict update rules
    await assertFails(setDoc(chatRefAlice, newChatData));

    // F. Normal message while status == 'pending' is strictly DENIED
    await assertFails(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/m1`), {
        senderUid: 'alice_uid',
        text: 'Premature message before acceptance',
        type: 'text',
        createdAt: serverTimestamp(),
      })
    );

    // G. RequestPreview immutability: attempting to change requestPreview fails
    await assertFails(
      updateDoc(chatRefAlice, {
        requestPreview: 'Tampered preview',
      })
    );

    // H. Recipient (Bob) accepts request -> transitions status to 'active'
    await assertSucceeds(
      updateDoc(chatRefBob, {
        status: 'active',
        acceptedAt: serverTimestamp(),
      })
    );

    // I. Normal message after acceptance (status == 'active') is ALLOWED
    await assertSucceeds(
      setDoc(doc(aliceDb, `direct_chats/${chatId}/messages/m1`), {
        senderUid: 'alice_uid',
        text: 'Hello Bob! Glad you accepted.',
        type: 'text',
        createdAt: serverTimestamp(),
      })
    );

    // J. Bob can also respond when active
    await assertSucceeds(
      setDoc(doc(bobDb, `direct_chats/${chatId}/messages/m2`), {
        senderUid: 'bob_uid',
        text: 'Hi Alice, great to connect!',
        type: 'text',
        createdAt: serverTimestamp(),
      })
    );
  });

  test('Section 36: Firestore Permanent Deletion Authorization, Non-Surveillance & Shared Ownership Rules', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();
    const adminDb = testEnv.authenticatedContext('0yZ0Zl1yv1Z5w2X1q0r8s9t0u1v2', { email: 'admin@example.com', email_verified: true }).firestore();

    const noteRef = doc(aliceDb, 'users/alice_uid/notes/note_1');
    const nbRef = doc(aliceDb, 'users/alice_uid/notebooks/nb_1');

    // Setup notes and notebooks for Alice
    await assertSucceeds(setDoc(noteRef, { title: 'Alice Note', ownerId: 'alice_uid', trashed: true }));
    await assertSucceeds(setDoc(nbRef, { name: 'Alice Notebook', ownerId: 'alice_uid', trashed: true }));

    // 1. Cross-user denial: Bob cannot delete Alice's note
    await assertFails(deleteDoc(doc(bobDb, 'users/alice_uid/notes/note_1')));

    // 2. Cross-user denial: Bob cannot delete Alice's notebook
    await assertFails(deleteDoc(doc(bobDb, 'users/alice_uid/notebooks/nb_1')));

    // 3. Infrastructure Owner Non-Surveillance: Admin cannot delete Alice's private note
    await assertFails(deleteDoc(doc(adminDb, 'users/alice_uid/notes/note_1')));

    // 4. Infrastructure Owner Non-Surveillance: Admin cannot delete Alice's private notebook
    await assertFails(deleteDoc(doc(adminDb, 'users/alice_uid/notebooks/nb_1')));

    // 5. Alice can delete her own note and notebook
    await assertSucceeds(deleteDoc(noteRef));
    await assertSucceeds(deleteDoc(nbRef));

    // 6. Shared Notes deletion rules
    const sharedNoteRef = doc(aliceDb, 'shared_notes/shared_note_1');
    await assertSucceeds(setDoc(sharedNoteRef, {
      title: 'Shared Note',
      ownerId: 'alice_uid',
      sharedWith: ['bob@example.com'],
      editors: ['bob@example.com'],
      isPublished: false,
    }));

    // Collaborator Bob CANNOT permanently delete Alice's shared note
    await assertFails(deleteDoc(doc(bobDb, 'shared_notes/shared_note_1')));

    // Infrastructure Admin CANNOT delete Alice's shared note (no owner bypass)
    await assertFails(deleteDoc(doc(adminDb, 'shared_notes/shared_note_1')));

    // Owner Alice CAN permanently delete her own shared note
    await assertSucceeds(deleteDoc(sharedNoteRef));

    // 7. Shared Notebooks deletion rules
    const sharedNbRef = doc(aliceDb, 'shared_notebooks/shared_nb_1');
    await assertSucceeds(setDoc(sharedNbRef, {
      name: 'Shared Notebook',
      ownerId: 'alice_uid',
      sharedWith: ['bob@example.com'],
      editors: ['bob@example.com'],
    }));

    // Collaborator Bob CANNOT permanently delete Alice's shared notebook
    await assertFails(deleteDoc(doc(bobDb, 'shared_notebooks/shared_nb_1')));

    // Owner Alice CAN permanently delete her own shared notebook
    await assertSucceeds(deleteDoc(sharedNbRef));
  });

  test('Production commitQueuedNoteSafely against live Firestore Emulator: Unchanged update, Concurrent edit, Remote deletion, New creation, and Owner-shared collaborator edit', async () => {
    const aliceDb = testEnv.authenticatedContext('alice_uid', { email: 'alice@example.com', email_verified: true }).firestore();
    const bobDb = testEnv.authenticatedContext('bob_uid', { email: 'bob@example.com', email_verified: true }).firestore();

    const noteId = 'trans_note_1';
    const initialNote: Note = {
      id: noteId,
      title: 'Initial Title',
      content: 'Initial Content',
      tags: [],
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      ownerId: 'alice_uid',
      createdAt: '2026-09-08T10:00:00.000Z',
      updatedAt: '2026-09-08T10:00:00.000Z',
    };

    // 1. New note creation: remote doc absent, no baseUpdatedAt -> committed
    const createQueueItem: SyncQueueItem = {
      id: 'q_create',
      noteId,
      operation: 'upsert',
      createdAt: '2026-09-08T10:00:00.000Z',
      attempts: 0,
    };
    const createRes = await commitQueuedNoteSafely(aliceDb as any, 'alice_uid', initialNote, createQueueItem);
    assert.equal(createRes.status, 'committed');

    // Verify written to emulator
    const writtenSnap = await getDoc(doc(aliceDb, `users/alice_uid/notes/${noteId}`));
    assert.equal(writtenSnap.exists(), true);
    assert.equal((writtenSnap.data() as Note).title, 'Initial Title');

    // 2. Unchanged update: local updated note with baseUpdatedAt == remote updatedAt -> committed
    const updatedNote: Note = {
      ...initialNote,
      title: 'Alice Updated Title',
      updatedAt: '2026-09-08T10:05:00.000Z',
    };
    const updateQueueItem: SyncQueueItem = {
      id: 'q_update',
      noteId,
      operation: 'upsert',
      createdAt: '2026-09-08T10:05:00.000Z',
      attempts: 0,
      baseUpdatedAt: '2026-09-08T10:00:00.000Z', // Matches remote
    };
    const updateRes = await commitQueuedNoteSafely(aliceDb as any, 'alice_uid', updatedNote, updateQueueItem);
    assert.equal(updateRes.status, 'committed');

    // 3. Concurrent remote update: remote has newer timestamp than baseUpdatedAt -> conflict
    // First simulate remote changing concurrently on server
    await setDoc(doc(aliceDb, `users/alice_uid/notes/${noteId}`), {
      ...updatedNote,
      title: 'Remote Concurrent Title',
      updatedAt: '2026-09-08T10:10:00.000Z',
    });

    const localStaleNote: Note = {
      ...updatedNote,
      title: 'Local Stale Edit',
      updatedAt: '2026-09-08T10:12:00.000Z',
    };
    const staleQueueItem: SyncQueueItem = {
      id: 'q_stale',
      noteId,
      operation: 'upsert',
      createdAt: '2026-09-08T10:12:00.000Z',
      attempts: 0,
      baseUpdatedAt: '2026-09-08T10:05:00.000Z', // Does NOT match remote 10:10:00
    };
    const conflictRes = await commitQueuedNoteSafely(aliceDb as any, 'alice_uid', localStaleNote, staleQueueItem);
    assert.equal(conflictRes.status, 'conflict');
    if (conflictRes.status === 'conflict') {
      assert.equal(conflictRes.remoteNote.title, 'Remote Concurrent Title');
    }

    // 4. Remote deletion: baseUpdatedAt present, but remote document was deleted -> remote_deleted, NOT committed
    await deleteDoc(doc(aliceDb, `users/alice_uid/notes/${noteId}`));
    const remoteDelRes = await commitQueuedNoteSafely(aliceDb as any, 'alice_uid', localStaleNote, staleQueueItem);
    assert.equal(remoteDelRes.status, 'remote_deleted');
    if (remoteDelRes.status === 'remote_deleted') {
      assert.equal(remoteDelRes.noteId, noteId);
    }
    // Verify document was NOT resurrected in emulator
    const checkDeletedSnap = await getDoc(doc(aliceDb, `users/alice_uid/notes/${noteId}`));
    assert.equal(checkDeletedSnap.exists(), false, 'Remotely deleted note must NOT be resurrected');

    // 5. Owner-shared collaborator change on shared authority -> conflict detected
    const sharedNoteId = 'trans_shared_note_1';
    const sharedNote: Note = {
      id: sharedNoteId,
      title: 'Shared Note Alice',
      content: 'Shared Content',
      tags: [],
      color: 'default',
      pinned: false,
      archived: false,
      trashed: false,
      ownerId: 'alice_uid',
      isShared: true,
      sharedWith: ['bob@example.com'],
      editors: ['bob@example.com'],
      createdAt: '2026-09-08T10:00:00.000Z',
      updatedAt: '2026-09-08T10:00:00.000Z',
    };

    // Seed owner's private doc and shared_notes authority
    await setDoc(doc(aliceDb, `users/alice_uid/notes/${sharedNoteId}`), sharedNote);
    await setDoc(doc(aliceDb, `shared_notes/${sharedNoteId}`), sharedNote);

    // Bob edits shared_notes authority
    await setDoc(doc(bobDb, `shared_notes/${sharedNoteId}`), {
      ...sharedNote,
      title: 'Bob Collaborative Edit',
      updatedAt: '2026-09-08T10:20:00.000Z',
    });

    // Alice attempts to sync local edit based on baseUpdatedAt = 10:00:00
    const aliceLocalEdit: Note = {
      ...sharedNote,
      title: 'Alice Local Edit',
      updatedAt: '2026-09-08T10:25:00.000Z',
    };
    const aliceSharedQueueItem: SyncQueueItem = {
      id: 'q_alice_shared',
      noteId: sharedNoteId,
      operation: 'upsert',
      createdAt: '2026-09-08T10:25:00.000Z',
      attempts: 0,
      baseUpdatedAt: '2026-09-08T10:00:00.000Z',
    };
    const sharedConflictRes = await commitQueuedNoteSafely(aliceDb as any, 'alice_uid', aliceLocalEdit, aliceSharedQueueItem);
    assert.equal(sharedConflictRes.status, 'conflict');
    if (sharedConflictRes.status === 'conflict') {
      assert.equal(sharedConflictRes.remoteNote.title, 'Bob Collaborative Edit');
    }
  });
});
