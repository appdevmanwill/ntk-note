import type { Note, Notebook, ShareAccess, ShareRole } from '@/types';

export const roleLabels: Record<ShareRole, string> = {
  owner: 'Owner',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
};

export const collaboratorRoles: Exclude<ShareRole, 'owner'>[] = ['editor', 'commenter', 'viewer'];

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

export const normalizeShareAccess = (access: ShareAccess[] = []): ShareAccess[] => {
  const byEmail = new Map<string, ShareAccess>();
  access.forEach(item => {
    const email = normalizeEmail(item.email);
    if (!email) return;
    byEmail.set(email, {
      email,
      role: item.role || 'editor',
      addedAt: item.addedAt || new Date().toISOString(),
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
    return previous.get(normalized) || {
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
