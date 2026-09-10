import type { Note, Notebook, ShareAccess, ShareRole } from '@/types';

export const roleLabels: Record<ShareRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export const collaboratorRoles: Exclude<ShareRole, 'owner'>[] = ['editor', 'commenter', 'viewer'];

export const normalizeEmail = (email: string) => (typeof email === 'string' ? email.trim().toLowerCase() : '');

export const normalizeDirectorySearchTerm = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

export const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(value));

/**
 * Build bounded prefix tokens for the signed-in collaboration directory.
 * Prefixes start at three characters so the UI never performs 1-2 letter
 * directory scans. We index the full name, individual name words, the email
 * local-part, and the full email to support useful recipient discovery.
 */
export const buildDirectorySearchPrefixes = (name: string, email: string): string[] => {
  const normalizedName = normalizeDirectorySearchTerm(name);
  const normalizedEmail = normalizeDirectorySearchTerm(email);
  const emailLocalPart = normalizedEmail.split('@')[0] || '';
  const tokens = new Set<string>([
    normalizedName,
    ...normalizedName.split(' '),
    emailLocalPart,
    normalizedEmail,
  ].filter(token => token.length >= 3));

  const prefixes = new Set<string>();
  tokens.forEach(token => {
    const maxLength = Math.min(token.length, 48);
    for (let length = 3; length <= maxLength; length += 1) {
      prefixes.add(token.slice(0, length));
    }
  });

  // Keep the directory record compact even for unusually long names/emails.
  return [...prefixes].slice(0, 180);
};

export const normalizeShareAccess = (access: ShareAccess[] = []): ShareAccess[] => {
  const byEmail = new Map<string, ShareAccess>();
  access.forEach(item => {
    const email = normalizeEmail(item.email);
    if (!email) return;
    const existing = byEmail.get(email);
    byEmail.set(email, {
      email,
      role: item.role || 'editor',
      addedAt: item.addedAt || new Date().toISOString(),
      uid: item.uid || existing?.uid,
      displayName: item.displayName || existing?.displayName,
      photoURL: item.photoURL || existing?.photoURL,
    });
  });
  return [...byEmail.values()];
};

export const legacyEmailsToShareAccess = (
  emails: string[] = [],
  previousAccess: ShareAccess[] = []
): ShareAccess[] => {
  const previous = new Map(normalizeShareAccess(previousAccess).map(item => [item.email, item]));
  return normalizeShareAccess(emails.map(email => {
    const normalized = normalizeEmail(email);
    const prev = previous.get(normalized);
    return prev || {
      email: normalized,
      role: 'editor',
      addedAt: new Date().toISOString(),
    };
  }));
};

export const shareAccessToRoleArrays = (access: ShareAccess[]) => {
  const normalized = normalizeShareAccess(access);
  return {
    sharedWith: normalized.map(item => item.email),
    editors: normalized.filter(item => item.role === 'editor').map(item => item.email),
    commenters: normalized.filter(item => item.role === 'commenter').map(item => item.email),
    viewers: normalized.filter(item => item.role === 'viewer').map(item => item.email),
  };
};

export const getEntityRole = (
  entity: Pick<Note | Notebook, 'ownerId' | 'sharedWith' | 'shareAccess' | 'editors' | 'commenters' | 'viewers' | 'isShared'>,
  email?: string,
  uid?: string | null
): ShareRole => {
  const normalizedEmail = normalizeEmail(email || '');
  if (!entity.isShared || !entity.ownerId || entity.ownerId === uid) return 'owner';

  const access = normalizeShareAccess(entity.shareAccess);
  const explicit = access.find(item => item.email === normalizedEmail);
  if (explicit) return explicit.role;

  if (entity.editors?.includes(normalizedEmail)) return 'editor';
  if (entity.commenters?.includes(normalizedEmail)) return 'commenter';
  if (entity.viewers?.includes(normalizedEmail)) return 'viewer';
  if (entity.sharedWith?.includes(normalizedEmail)) return 'editor';
  return 'viewer';
};

export const canEditRole = (role: ShareRole) => role === 'owner' || role === 'editor';
export const canCommentRole = (role: ShareRole) => role === 'owner' || role === 'editor' || role === 'commenter';

export const canEditSharedNote = (note: Pick<Note, 'ownerId' | 'sharedWith' | 'shareAccess' | 'editors' | 'commenters' | 'viewers' | 'isShared'>, uid?: string | null, email?: string) => {
  const role = getEntityRole(note, email, uid);
  return canEditRole(role);
};

export const canCommentSharedNote = (note: Pick<Note, 'ownerId' | 'sharedWith' | 'shareAccess' | 'editors' | 'commenters' | 'viewers' | 'isShared'>, uid?: string | null, email?: string) => {
  const role = getEntityRole(note, email, uid);
  return canCommentRole(role);
};

export const getEntityParticipants = (
  entity: Pick<Note | Notebook, 'sharedWith' | 'shareAccess' | 'sharedBy'>,
  ownerEmail?: string
) => {
  const emails = new Set<string>();
  normalizeShareAccess(entity.shareAccess).forEach(item => emails.add(item.email));
  entity.sharedWith?.forEach(email => emails.add(normalizeEmail(email)));
  if (ownerEmail) emails.add(normalizeEmail(ownerEmail));
  if (entity.sharedBy) emails.add(normalizeEmail(entity.sharedBy));
  return [...emails].filter(Boolean);
};

export interface QuickContact {
  email: string;
  name?: string;
  username?: string;
  photoURL?: string;
  uid?: string;
  relationshipHint?: string;
}

export const getQuickShareSuggestions = (
  notes: Note[] = [],
  notebooks: Notebook[] = [],
  _currentUid?: string | null,
  currentEmail?: string | null,
  maxLimit = 8,
  knownChats?: Array<{ participantUids?: string[]; participantEmails?: string[]; participantData?: Record<string, { name?: string; email?: string; photoURL?: string }> }>
): QuickContact[] => {
  const ownEmail = normalizeEmail(currentEmail || '');
  const scoreMap = new Map<string, { email: string; name?: string; count: number; lastSeen: number; uid?: string; photoURL?: string }>();

  const recordContact = (
    rawEmail?: string,
    dateStr?: string,
    meta?: { uid?: string; name?: string; photoURL?: string }
  ) => {
    if (!rawEmail) return;
    const email = normalizeEmail(rawEmail);
    if (!email || email === ownEmail) return;
    const ts = dateStr ? new Date(dateStr).getTime() : Date.now();
    const existing = scoreMap.get(email);
    if (existing) {
      existing.count += 1;
      if (ts > existing.lastSeen) existing.lastSeen = ts;
      if (!existing.uid && meta?.uid) existing.uid = meta.uid;
      if ((!existing.name || existing.name === email.split('@')[0]) && meta?.name) existing.name = meta.name;
      if (!existing.photoURL && meta?.photoURL) existing.photoURL = meta.photoURL;
    } else {
      scoreMap.set(email, {
        email,
        name: meta?.name || email.split('@')[0],
        count: 1,
        lastSeen: ts,
        uid: meta?.uid,
        photoURL: meta?.photoURL,
      });
    }
  };

  notes.forEach(note => {
    const isOwnerCollaborator = note.ownerId && note.ownerId !== _currentUid;
    recordContact(note.sharedBy, note.updatedAt || note.createdAt, isOwnerCollaborator ? { uid: note.ownerId } : undefined);
    if (note.sharedWith) {
      note.sharedWith.forEach(e => recordContact(e, note.updatedAt || note.createdAt));
    }
    if (note.shareAccess) {
      note.shareAccess.forEach(a => recordContact(a.email, a.addedAt || note.updatedAt, {
        uid: a.uid,
        name: a.displayName,
        photoURL: a.photoURL,
      }));
    }
  });

  notebooks.forEach(nb => {
    const isOwnerCollaborator = nb.ownerId && nb.ownerId !== _currentUid;
    recordContact(nb.sharedBy, nb.createdAt, isOwnerCollaborator ? { uid: nb.ownerId } : undefined);
    if (nb.sharedWith) {
      nb.sharedWith.forEach(e => recordContact(e, nb.createdAt));
    }
    if (nb.shareAccess) {
      nb.shareAccess.forEach(a => recordContact(a.email, a.addedAt || nb.createdAt, {
        uid: a.uid,
        name: a.displayName,
        photoURL: a.photoURL,
      }));
    }
  });

  if (knownChats && knownChats.length > 0) {
    knownChats.forEach(chat => {
      const emails = chat.participantEmails || [];
      const uids = chat.participantUids || [];
      const otherUid = uids.find(u => u !== _currentUid);
      const pData = (chat.participantData && otherUid) ? chat.participantData[otherUid] : undefined;
      const chatTs = (chat as any).updatedAt || (chat as any).createdAt;
      emails.forEach(e => {
        const norm = normalizeEmail(e);
        if (norm && norm !== ownEmail) {
          recordContact(norm, chatTs, {
            uid: otherUid,
            name: pData?.name,
            photoURL: pData?.photoURL,
          });
        }
      });
    });
  }

  const sorted = [...scoreMap.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen - a.lastSeen;
  });

  return sorted.slice(0, maxLimit).map(item => ({
    email: item.email,
    name: item.name,
    uid: item.uid,
    photoURL: item.photoURL,
    relationshipHint: 'Recent collaborator',
  }));
};

export const filterLocalContacts = (
  contacts: QuickContact[],
  queryText: string,
  maxLimit = 8
): QuickContact[] => {
  const normQuery = normalizeDirectorySearchTerm(queryText);
  if (!normQuery) return contacts.slice(0, maxLimit);

  return contacts.filter(c => {
    const normEmail = normalizeDirectorySearchTerm(c.email);
    const normName = normalizeDirectorySearchTerm(c.name || '');
    const normUser = normalizeDirectorySearchTerm(c.username || '');
    const localPart = normEmail.split('@')[0] || '';

    return (
      normEmail.includes(normQuery) ||
      normName.includes(normQuery) ||
      normUser.includes(normQuery) ||
      localPart.includes(normQuery)
    );
  }).slice(0, maxLimit);
};
