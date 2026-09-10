import { useState, useEffect, useMemo, useRef } from 'react';
import { useStore } from '@/store';
import { db, auth } from '@/utils/firebase';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import {
  X,
  UserPlus,
  Globe,
  Copy,
  Check,
  Users,
  Trash2,
  Share2,
  LoaderCircle,
  MessageSquare,
  Sparkles,
  Search,
} from 'lucide-react';
import type { ShareAccess, ShareRole } from '@/types';
import {
  collaboratorRoles,
  isValidEmail,
  legacyEmailsToShareAccess,
  normalizeDirectorySearchTerm,
  normalizeEmail,
  normalizeShareAccess,
  roleLabels,
  getQuickShareSuggestions,
  filterLocalContacts,
  type QuickContact,
} from '@/utils/collaboration';
import {
  QUICK_SHARE_LIMIT,
  GLOBAL_DIRECTORY_MIN_CHARS,
  GLOBAL_DIRECTORY_LIMIT,
  DIRECTORY_DEBOUNCE_MS,
} from '@/utils/freeZoneConstants';
import UserAvatar from '@/components/UserAvatar';
import { getOrCreateDirectChat } from '@/utils/chatService';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'note' | 'notebook';
  entityId: string;
}

export default function ShareModal({ isOpen, onClose, entityType, entityId }: ShareModalProps) {
  const {
    notes,
    notebooks,
    shareNote,
    shareNotebook,
    profile,
    setCurrentView,
    setActiveChatId,
  } = useStore();

  const note = entityType === 'note' ? notes.find(n => n.id === entityId) : null;
  const notebook = entityType === 'notebook' ? notebooks.find(nb => nb.id === entityId) : null;

  const [searchInput, setSearchInput] = useState('');
  const [newUserRole, setNewUserRole] = useState<Exclude<ShareRole, 'owner'>>('viewer');
  const [remoteDirectoryResults, setRemoteDirectoryResults] = useState<QuickContact[]>([]);
  const [shareAccess, setShareAccess] = useState<ShareAccess[]>([]);
  const [isPublished, setIsPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [shareMessage, setShareMessage] = useState('');
  const [shareSaving, setShareSaving] = useState(false);
  const [messagingStarting, setMessagingStarting] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  // Focus trap: Escape closes, Tab wraps
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen) {
      if (note) {
        setShareAccess(normalizeShareAccess(note.shareAccess || legacyEmailsToShareAccess(note.sharedWith || [])));
        setIsPublished(!!note.isPublished);
      } else if (notebook) {
        setShareAccess(normalizeShareAccess(notebook.shareAccess || legacyEmailsToShareAccess(notebook.sharedWith || [])));
      }
      setSearchInput('');
      setRemoteDirectoryResults([]);
      setDirectoryLoading(false);
      setShareMessage('');
      setShareSaving(false);
      setNewUserRole('viewer');
      setMessagingStarting(null);
    }
  }, [isOpen, note, notebook, profile.email]);

  // Compute zero-read quick share suggestions from local notes & notebooks
  const quickShareSuggestions = useMemo(() => {
    if (!isOpen) return [];
    return getQuickShareSuggestions(notes, notebooks, auth.currentUser?.uid, profile.email, QUICK_SHARE_LIMIT);
  }, [isOpen, notes, notebooks, profile.email]);

  // Character 1+: Instant local filtering with ZERO Firestore reads
  const localFilteredSuggestions = useMemo(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) return [];
    return filterLocalContacts(quickShareSuggestions, trimmed, QUICK_SHARE_LIMIT);
  }, [searchInput, quickShareSuggestions]);

  // Character 3+: Debounced bounded remote directory search
  useEffect(() => {
    const candidate = normalizeDirectorySearchTerm(searchInput);
    const ownEmail = normalizeEmail(profile.email);

    if (!isOpen || candidate.length < GLOBAL_DIRECTORY_MIN_CHARS || candidate === ownEmail) {
      setRemoteDirectoryResults([]);
      setDirectoryLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setDirectoryLoading(true);
      try {
        let found: QuickContact[] = [];

        if (isValidEmail(candidate)) {
          const snapshot = await getDoc(doc(db, 'users_directory', normalizeEmail(candidate)));
          const data = snapshot.data();
          if (snapshot.exists() && data && data.discoverable !== false) {
            found = [{
              email: normalizeEmail(String(data.email || candidate)),
              name: String(data.name || ''),
              uid: data.uid ? String(data.uid) : undefined,
              photoURL: data.photoURL ? String(data.photoURL) : undefined,
              relationshipHint: 'Registered NTK Note user',
            }];
          }
        } else {
          const directoryQuery = query(
            collection(db, 'users_directory'),
            where('discoverable', '==', true),
            where('searchPrefixes', 'array-contains', candidate),
            limit(GLOBAL_DIRECTORY_LIMIT)
          );
          const snapshot = await getDocs(directoryQuery);
          const items: QuickContact[] = [];
          snapshot.docs.forEach(directoryDoc => {
            const data = directoryDoc.data();
            if (data.discoverable !== false) {
              items.push({
                email: normalizeEmail(String(data.email || directoryDoc.id)),
                name: String(data.name || ''),
                uid: data.uid ? String(data.uid) : undefined,
                photoURL: data.photoURL ? String(data.photoURL) : undefined,
                relationshipHint: 'Registered NTK Note user',
              });
            }
          });
          found = items;
        }

        if (cancelled) return;

        const unique = new Map<string, QuickContact>();
        found
          .filter(user => user.email && user.email !== ownEmail)
          .forEach(user => unique.set(user.email, user));

        const results = [...unique.values()]
          .sort((a, b) => (a.name || '').localeCompare(b.name || '') || a.email.localeCompare(b.email))
          .slice(0, GLOBAL_DIRECTORY_LIMIT);

        setRemoteDirectoryResults(results);
      } catch (error) {
        if (cancelled) return;
        console.warn('Directory search error:', error);
        setRemoteDirectoryResults([]);
      } finally {
        if (!cancelled) setDirectoryLoading(false);
      }
    }, DIRECTORY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchInput, isOpen, profile.email]);

  // Combined search suggestions (local first, then remote results without duplicates)
  const combinedSearchResults = useMemo(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) return [];
    const seen = new Set<string>();
    const combined: QuickContact[] = [];

    localFilteredSuggestions.forEach(c => {
      seen.add(c.email);
      combined.push(c);
    });

    remoteDirectoryResults.forEach(c => {
      if (!seen.has(c.email)) {
        seen.add(c.email);
        combined.push(c);
      }
    });

    return combined.slice(0, GLOBAL_DIRECTORY_LIMIT);
  }, [searchInput, localFilteredSuggestions, remoteDirectoryResults]);

  if (!isOpen) return null;

  const commitAccess = async (nextAccess: ShareAccess[], nextPublished = isPublished) => {
    if (shareSaving) return false;
    const normalized = normalizeShareAccess(nextAccess);
    const previousAccess = shareAccess;
    const previousPublished = isPublished;
    setShareAccess(normalized);
    setShareSaving(true);
    setShareMessage('Saving changes...');
    const emails = normalized.map(item => item.email);

    try {
      if (entityType === 'note') {
        await shareNote(entityId, emails, nextPublished, normalized);
      } else {
        await shareNotebook(entityId, emails, normalized);
      }
      setShareMessage('Sharing updated successfully.');
      return true;
    } catch (error) {
      console.error('Could not update sharing:', error);
      setShareAccess(previousAccess);
      setIsPublished(previousPublished);
      setShareMessage('Sharing could not be saved. Check your connection.');
      return false;
    } finally {
      setShareSaving(false);
    }
  };

  const addShareUser = async (email: string, roleToUse = newUserRole, contactMeta?: { uid?: string; name?: string; photoURL?: string }) => {
    const trimmed = normalizeEmail(email);
    if (!isValidEmail(trimmed)) {
      setShareMessage('Choose a registered user or enter a valid email address.');
      return;
    }
    if (trimmed === normalizeEmail(profile.email)) {
      setShareMessage('You already own this item.');
      return;
    }

    let meta = contactMeta;
    if (!meta?.uid) {
      const foundInQuick = quickShareSuggestions.find(c => c.email === trimmed);
      const foundInRemote = remoteDirectoryResults.find(c => c.email === trimmed);
      const candidate = foundInQuick || foundInRemote;
      if (candidate) {
        meta = {
          uid: candidate.uid || meta?.uid,
          name: candidate.name || meta?.name,
          photoURL: candidate.photoURL || meta?.photoURL,
        };
      }
    }

    const current = normalizeShareAccess(shareAccess);
    const exists = current.some(item => item.email === trimmed);
    const updated = exists
      ? current.map(item => item.email === trimmed ? {
          ...item,
          role: roleToUse,
          uid: meta?.uid || item.uid,
          displayName: meta?.name || item.displayName,
          photoURL: meta?.photoURL || item.photoURL,
        } : item)
      : [...current, {
          email: trimmed,
          role: roleToUse,
          addedAt: new Date().toISOString(),
          uid: meta?.uid,
          displayName: meta?.name,
          photoURL: meta?.photoURL,
        }];

    const saved = await commitAccess(updated);
    if (saved) {
      setSearchInput('');
      setRemoteDirectoryResults([]);
    }
  };

  const removeShareUser = (email: string) => {
    void commitAccess(shareAccess.filter(item => item.email !== email));
  };

  const updateShareRole = (email: string, role: Exclude<ShareRole, 'owner'>) => {
    void commitAccess(shareAccess.map(item => item.email === email ? { ...item, role } : item));
  };

  const togglePublicPublish = () => {
    if (entityType !== 'note' || shareSaving) return;
    const nextPublished = !isPublished;
    setIsPublished(nextPublished);
    void commitAccess(shareAccess, nextPublished);
  };

  const getPublicUrl = () => `${window.location.origin}/?p=${entityId}`;

  const copyLink = () => {
    void navigator.clipboard.writeText(getPublicUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleStartMessage = async (targetEmail: string, knownUid?: string, targetName?: string) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setShareMessage('Sign in to message collaborators.');
      return;
    }

    setMessagingStarting(targetEmail);
    try {
      let resolvedUid = knownUid;
      let resolvedName = targetName;
      let resolvedPhoto: string | undefined;

      if (!resolvedUid) {
        const directorySnap = await getDoc(doc(db, 'users_directory', normalizeEmail(targetEmail)));
        if (directorySnap.exists()) {
          const data = directorySnap.data();
          resolvedUid = data.uid ? String(data.uid) : undefined;
          resolvedName = resolvedName || (data.name ? String(data.name) : undefined);
          resolvedPhoto = data.photoURL ? String(data.photoURL) : undefined;
        }
      }

      if (!resolvedUid) {
        setShareMessage(`${targetName || targetEmail} has not enabled direct messaging yet.`);
        return;
      }

      const chat = await getOrCreateDirectChat(
        {
          uid: resolvedUid,
          email: targetEmail,
          name: resolvedName || targetEmail.split('@')[0],
          photoURL: resolvedPhoto,
        },
        true // They are a participant on this note/notebook, so active collaboration
      );

      setActiveChatId(chat.id);
      setCurrentView('messages');
      onClose();
    } catch (error) {
      console.warn('Could not start direct chat from share:', error);
      setShareMessage('Could not open conversation right now.');
    } finally {
      setMessagingStarting(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="share-modal-title">
      <div ref={modalRef} className="bg-[var(--card-bg)] border theme-border rounded-2xl shadow-2xl w-full max-w-xl flex flex-col overflow-hidden max-h-[90dvh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b theme-divider">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 accent-text" />
            <h3 id="share-modal-title" className="text-lg font-bold text-theme-primary">
              Share {entityType === 'note' ? 'Note' : 'Notebook'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer"
            aria-label="Close share dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-6 overflow-y-auto max-h-[75vh]">

          {/* Section 1: PEOPLE WITH ACCESS (Current user is always at the top) */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs uppercase font-bold tracking-wider text-theme-tertiary flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" />
                People with access ({shareAccess.length + 1})
              </h4>
            </div>

            <div className="space-y-2 border theme-border rounded-xl p-3 bg-[var(--app-bg-subtle)]/15">
              {/* CURRENT SIGNED-IN USER (Owner • You) */}
              <div className="flex items-center justify-between gap-3 py-1 px-2 rounded-lg bg-[var(--app-bg-subtle)]/30">
                <div className="flex items-center gap-2.5 min-w-0">
                  <UserAvatar profile={profile} size="sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-theme-primary truncate">
                      {profile.name || profile.email.split('@')[0] || 'You'}
                    </p>
                    <p className="text-[11px] text-theme-tertiary font-mono truncate">
                      {profile.email}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-[var(--app-bg-subtle)] border theme-border text-theme-secondary">
                    Owner • You
                  </span>
                </div>
              </div>

              {/* Other Participants */}
              {shareAccess.map(access => {
                const displayName = access.email.split('@')[0];
                return (
                  <div key={access.email} className="flex items-center justify-between gap-3 py-1 px-2 rounded-lg border theme-border bg-[var(--card-bg)]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UserAvatar profile={{ name: displayName, avatar: undefined }} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-theme-primary truncate">{displayName}</p>
                        <p className="text-[11px] text-theme-tertiary font-mono truncate">{access.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Message Action */}
                      <button
                        type="button"
                        onClick={() => void handleStartMessage(access.email, access.uid, displayName)}
                        disabled={messagingStarting === access.email || shareSaving}
                        className="p-1.5 rounded-lg theme-hover text-theme-secondary hover:text-[var(--accent-primary)] cursor-pointer"
                        title={`Message ${displayName}`}
                        aria-label={`Send private message to ${displayName}`}
                      >
                        {messagingStarting === access.email ? (
                          <LoaderCircle className="w-3.5 h-3.5 animate-spin text-theme-tertiary" />
                        ) : (
                          <MessageSquare className="w-3.5 h-3.5" />
                        )}
                      </button>

                      {/* Role Selector */}
                      <select
                        value={access.role}
                        onChange={event => updateShareRole(access.email, event.target.value as Exclude<ShareRole, 'owner'>)}
                        disabled={shareSaving}
                        className="rounded-lg border theme-input px-2 py-1 text-xs text-theme-secondary focus:outline-none"
                        aria-label={`Role for ${access.email}`}
                      >
                        {collaboratorRoles.map(role => (
                          <option key={role} value={role}>{roleLabels[role]}</option>
                        ))}
                      </select>

                      {/* Remove Button */}
                      <button
                        onClick={() => removeShareUser(access.email)}
                        disabled={shareSaving}
                        className="p-1.5 rounded-lg theme-hover text-theme-tertiary hover:text-red-500 cursor-pointer"
                        title="Remove collaborator"
                        aria-label={`Remove ${access.email}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 2: QUICK SHARE (Visible without searching) */}
          {quickShareSuggestions.length > 0 && !searchInput.trim() && (
            <div className="space-y-2">
              <h4 className="text-xs uppercase font-bold tracking-wider text-theme-tertiary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Quick Share (Recent Collaborators)
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                {quickShareSuggestions.map(contact => {
                  const isAlreadyShared = shareAccess.some(a => a.email === contact.email);
                  return (
                    <div
                      key={contact.email}
                      className="flex items-center justify-between p-2 rounded-xl border theme-border bg-[var(--app-bg-subtle)]/15 hover:bg-[var(--app-bg-subtle)]/30 transition-colors gap-2"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar profile={{ name: contact.name || contact.email, avatar: contact.photoURL }} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-theme-primary truncate">
                            {contact.name || contact.email.split('@')[0]}
                          </p>
                          <p className="text-[10px] text-theme-tertiary truncate">{contact.relationshipHint}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isAlreadyShared ? (
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded bg-emerald-500/10">
                            Added
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void addShareUser(contact.email, 'viewer', { uid: contact.uid, name: contact.name, photoURL: contact.photoURL })}
                            disabled={shareSaving}
                            className="px-2.5 py-1 rounded-lg accent-button text-xs font-bold cursor-pointer disabled:opacity-50"
                          >
                            Share
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleStartMessage(contact.email, contact.uid, contact.name)}
                          disabled={messagingStarting === contact.email || shareSaving}
                          className="p-1 rounded-lg theme-hover text-theme-tertiary hover:text-theme-primary cursor-pointer"
                          title={`Message ${contact.name || contact.email}`}
                          aria-label={`Message ${contact.name || contact.email}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Section 3: FIND SOMEONE (1 char = instant local, 3+ char = bounded global) */}
          <div className="space-y-3">
            <label htmlFor="share-search-input" className="block text-xs uppercase font-bold tracking-wider text-theme-tertiary flex items-center gap-1.5">
              <Search className="w-3.5 h-3.5" />
              Find someone
            </label>

            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1 min-w-0">
                <input
                  id="share-search-input"
                  type="text"
                  value={searchInput}
                  onChange={e => {
                    setSearchInput(e.target.value);
                    setShareMessage('');
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      if (combinedSearchResults.length > 0) {
                        void addShareUser(combinedSearchResults[0].email, newUserRole, {
                          uid: combinedSearchResults[0].uid,
                          name: combinedSearchResults[0].name,
                          photoURL: combinedSearchResults[0].photoURL,
                        });
                      } else if (isValidEmail(searchInput)) {
                        void addShareUser(searchInput, newUserRole);
                      }
                    }
                  }}
                  placeholder="Type a name or email to search..."
                  autoComplete="off"
                  className="w-full px-3.5 py-2 pr-9 rounded-xl theme-input border text-sm focus:outline-none accent-focus"
                />
                {directoryLoading && (
                  <LoaderCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-theme-tertiary" />
                )}
              </div>

              <select
                value={newUserRole}
                onChange={e => setNewUserRole(e.target.value as Exclude<ShareRole, 'owner'>)}
                disabled={shareSaving}
                className="w-full sm:w-28 rounded-xl border theme-input px-2 py-2 text-xs font-semibold text-theme-secondary focus:outline-none"
                aria-label="New collaborator role"
              >
                {collaboratorRoles.map(role => (
                  <option key={role} value={role}>{roleLabels[role]}</option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => void addShareUser(searchInput, newUserRole)}
                disabled={!isValidEmail(searchInput) || shareSaving}
                className="px-4 py-2 rounded-xl accent-button text-xs font-bold cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Add
              </button>
            </div>

            {/* Suggestions list when typing */}
            {searchInput.trim() && (
              <div className="space-y-1 border theme-border rounded-xl p-2 bg-[var(--card-bg)] max-h-48 overflow-y-auto">
                {combinedSearchResults.length > 0 ? (
                  combinedSearchResults.map(u => {
                    const isAlreadyShared = shareAccess.some(a => a.email === u.email);
                    return (
                      <div
                        key={u.email}
                        className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--app-bg-subtle)]/40 transition-colors gap-2"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <UserAvatar profile={{ name: u.name || u.email, avatar: u.photoURL }} size="sm" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-theme-primary truncate">{u.name || u.email.split('@')[0]}</p>
                            <p className="text-[11px] text-theme-tertiary font-mono truncate">{u.email}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {isAlreadyShared ? (
                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 px-2 py-1 rounded bg-emerald-500/10">
                              Added
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void addShareUser(u.email, newUserRole, { uid: u.uid, name: u.name, photoURL: u.photoURL })}
                              disabled={shareSaving}
                              className="px-2.5 py-1 rounded-lg accent-button text-xs font-bold cursor-pointer disabled:opacity-50"
                            >
                              Share
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleStartMessage(u.email, u.uid, u.name)}
                            disabled={messagingStarting === u.email || shareSaving}
                            className="p-1 rounded-lg theme-hover text-theme-tertiary hover:text-theme-primary cursor-pointer"
                            title={`Message ${u.name || u.email}`}
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : !directoryLoading ? (
                  <p className="px-3 py-2 text-xs text-theme-tertiary">
                    {searchInput.trim().length < GLOBAL_DIRECTORY_MIN_CHARS
                      ? 'Type more characters to search the global directory...'
                      : 'No users found matching that search.'}
                  </p>
                ) : null}
              </div>
            )}

            {shareMessage && (
              <p
                className={`text-xs ${
                  shareMessage.includes('successfully')
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : shareMessage.includes('Saving')
                    ? 'text-theme-tertiary'
                    : 'text-red-500'
                }`}
                role="status"
                aria-live="polite"
              >
                {shareMessage}
              </p>
            )}
          </div>

          {/* Section 4: Public Publishing (for Notes only) */}
          {entityType === 'note' && (
            <div className="border-t theme-divider pt-5 space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-0.5">
                  <h4 className="text-sm font-semibold text-theme-secondary flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-theme-tertiary" />
                    Publish to Web (Public link)
                  </h4>
                  <p className="text-xs text-theme-tertiary max-w-sm">
                    Allow anyone with the link to view this note in a responsive reader view.
                  </p>
                </div>
                <button
                  onClick={togglePublicPublish}
                  className="w-10 h-6 rounded-full relative transition-colors cursor-pointer"
                  style={{ backgroundColor: isPublished ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                  role="switch"
                  aria-checked={isPublished}
                  aria-label="Toggle public web publishing"
                >
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isPublished ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {isPublished && (
                <div className="space-y-3 p-3.5 rounded-xl border theme-border bg-[var(--app-bg-subtle)]/10">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={getPublicUrl()}
                      className="flex-1 px-3 py-2 bg-[var(--input-bg)]/35 rounded-lg border theme-border text-xs font-mono text-theme-secondary focus:outline-none select-all"
                    />
                    <button
                      onClick={copyLink}
                      className="px-3 py-2 rounded-lg border theme-border theme-hover text-xs font-bold text-theme-secondary flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 bg-[var(--app-bg-subtle)]/40 border-t theme-divider flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl accent-button text-sm font-semibold cursor-pointer"
          >
            Done
          </button>
        </div>

      </div>
    </div>
  );
}
