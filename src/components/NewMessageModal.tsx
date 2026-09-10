import { useState, useMemo, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { db, auth } from '@/utils/firebase';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { X, Search, Sparkles, LoaderCircle, MessageSquare, UserPlus } from 'lucide-react';
import {
  getQuickShareSuggestions,
  filterLocalContacts,
  normalizeDirectorySearchTerm,
  normalizeEmail,
  isValidEmail,
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

interface NewMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  onChatSelected: (chatId: string) => void;
}

export default function NewMessageModal({ isOpen, onClose, onChatSelected }: NewMessageModalProps) {
  const { notes, notebooks, profile } = useStore();
  const [searchInput, setSearchInput] = useState('');
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [remoteResults, setRemoteResults] = useState<QuickContact[]>([]);
  const [startingChat, setStartingChat] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

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
      setSearchInput('');
      setRemoteResults([]);
      setDirectoryLoading(false);
      setStartingChat(null);
      setErrorMessage('');
    }
  }, [isOpen]);

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
      setRemoteResults([]);
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

        setRemoteResults(results);
      } catch (error) {
        if (cancelled) return;
        console.warn('NewMessageModal directory search error:', error);
        setRemoteResults([]);
      } finally {
        if (!cancelled) setDirectoryLoading(false);
      }
    }, DIRECTORY_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [searchInput, isOpen, profile.email]);

  const combinedSearchResults = useMemo(() => {
    const trimmed = searchInput.trim();
    if (!trimmed) return [];
    const seen = new Set<string>();
    const combined: QuickContact[] = [];

    localFilteredSuggestions.forEach(c => {
      seen.add(c.email);
      combined.push(c);
    });

    remoteResults.forEach(c => {
      if (!seen.has(c.email)) {
        seen.add(c.email);
        combined.push(c);
      }
    });

    return combined.slice(0, GLOBAL_DIRECTORY_LIMIT);
  }, [searchInput, localFilteredSuggestions, remoteResults]);

  if (!isOpen) return null;

  const handleSelectContact = async (contact: QuickContact) => {
    const currentUser = auth.currentUser;
    if (!currentUser) {
      setErrorMessage('Please sign in again to start a conversation.');
      return;
    }

    if (normalizeEmail(contact.email) === normalizeEmail(profile.email)) {
      setErrorMessage('You cannot message yourself.');
      return;
    }

    setStartingChat(contact.email);
    setErrorMessage('');

    try {
      let resolvedUid = contact.uid;
      let resolvedName = contact.name;
      let resolvedPhoto = contact.photoURL;

      // 1. Local resolution from existing notes
      if (!resolvedUid) {
        const normTarget = normalizeEmail(contact.email);
        for (const n of notes) {
          if (n.sharedBy && normalizeEmail(n.sharedBy) === normTarget && n.ownerId && n.ownerId !== currentUser.uid) {
            resolvedUid = n.ownerId;
            break;
          }
          if (n.shareAccess) {
            const acc = n.shareAccess.find(a => normalizeEmail(a.email) === normTarget && a.uid);
            if (acc?.uid) {
              resolvedUid = acc.uid;
              resolvedName = resolvedName || acc.displayName;
              resolvedPhoto = resolvedPhoto || acc.photoURL;
              break;
            }
          }
        }
      }

      // 2. Local resolution from existing notebooks
      if (!resolvedUid) {
        const normTarget = normalizeEmail(contact.email);
        for (const nb of notebooks) {
          if (nb.sharedBy && normalizeEmail(nb.sharedBy) === normTarget && nb.ownerId && nb.ownerId !== currentUser.uid) {
            resolvedUid = nb.ownerId;
            break;
          }
          if (nb.shareAccess) {
            const acc = nb.shareAccess.find(a => normalizeEmail(a.email) === normTarget && a.uid);
            if (acc?.uid) {
              resolvedUid = acc.uid;
              resolvedName = resolvedName || acc.displayName;
              resolvedPhoto = resolvedPhoto || acc.photoURL;
              break;
            }
          }
        }
      }

      // 3. Fall back to users_directory only if not resolved locally
      if (!resolvedUid) {
        try {
          const snap = await getDoc(doc(db, 'users_directory', normalizeEmail(contact.email)));
          if (snap.exists()) {
            const data = snap.data();
            if (data && data.discoverable !== false) {
              resolvedUid = data.uid ? String(data.uid) : undefined;
              resolvedName = resolvedName || (data.name ? String(data.name) : undefined);
              resolvedPhoto = resolvedPhoto || (data.photoURL ? String(data.photoURL) : undefined);
            }
          }
        } catch {
          // If directory lookup fails (e.g. non-discoverable user), handle safely below
        }
      }

      if (!resolvedUid) {
        setErrorMessage('This collaborator is not available for messaging yet.');
        return;
      }

      // Check if existing collaborator in local notes/notebooks
      const isKnownCollaborator = quickShareSuggestions.some(c => c.email === contact.email);

      const chat = await getOrCreateDirectChat(
        {
          uid: resolvedUid,
          email: contact.email,
          name: resolvedName || contact.email.split('@')[0],
          photoURL: resolvedPhoto,
        },
        isKnownCollaborator
      );

      onChatSelected(chat.id);
      onClose();
    } catch (error: any) {
      console.warn('[NTK Chat] Failed to start conversation:', error);
      if (!navigator.onLine) {
        setErrorMessage('Messaging could not connect. Please check your connection and try again.');
      } else if (error?.message?.includes('network') || error?.message?.includes('unavailable')) {
        setErrorMessage('Messaging could not connect. Please check your connection and try again.');
      } else {
        setErrorMessage('Could not start the conversation. Please try again.');
      }
    } finally {
      setStartingChat(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="new-message-modal-title">
      <div ref={modalRef} className="bg-[var(--card-bg)] border theme-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden max-h-[85dvh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b theme-divider">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 accent-text" />
            <h3 id="new-message-modal-title" className="text-base font-bold text-theme-primary">
              New Message
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer"
            aria-label="Close new message dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* Search bar */}
          <div className="relative">
            <input
              type="text"
              value={searchInput}
              onChange={e => {
                setSearchInput(e.target.value);
                setErrorMessage('');
              }}
              placeholder="Type name or email to message..."
              autoFocus
              className="w-full px-3.5 py-2.5 pr-9 rounded-xl theme-input border text-sm focus:outline-none accent-focus"
            />
            {directoryLoading ? (
              <LoaderCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-theme-tertiary" />
            ) : (
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-theme-tertiary" />
            )}
          </div>

          {errorMessage && (
            <p className="text-xs text-red-500 font-medium px-1" role="alert">
              {errorMessage}
            </p>
          )}

          {/* Quick Contacts / Recent collaborators (when no search query) */}
          {!searchInput.trim() && (
            <div className="space-y-2">
              <h4 className="text-xs uppercase font-bold tracking-wider text-theme-tertiary flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Recent Collaborators
              </h4>
              {quickShareSuggestions.length === 0 ? (
                <p className="text-xs text-theme-tertiary italic p-2">
                  No recent collaborators. Search for a registered NTK Note user above.
                </p>
              ) : (
                <div className="space-y-1">
                  {quickShareSuggestions.map(contact => (
                    <button
                      key={contact.email}
                      type="button"
                      onClick={() => void handleSelectContact(contact)}
                      disabled={startingChat === contact.email}
                      className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[var(--app-bg-subtle)]/40 transition-colors text-left border border-transparent hover:border-[var(--card-border)] cursor-pointer disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <UserAvatar profile={{ name: contact.name || contact.email, avatar: contact.photoURL }} size="sm" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-theme-primary truncate">
                            {contact.name || contact.email.split('@')[0]}
                          </p>
                          <p className="text-[11px] text-theme-tertiary font-mono truncate">{contact.email}</p>
                        </div>
                      </div>
                      {startingChat === contact.email ? (
                        <LoaderCircle className="w-4 h-4 animate-spin text-theme-tertiary shrink-0" />
                      ) : (
                        <MessageSquare className="w-4 h-4 text-theme-tertiary shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Search results list */}
          {searchInput.trim() && (
            <div className="space-y-1">
              <h4 className="text-xs uppercase font-bold tracking-wider text-theme-tertiary flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5" />
                Matching People
              </h4>
              {combinedSearchResults.length > 0 ? (
                combinedSearchResults.map(contact => (
                  <button
                    key={contact.email}
                    type="button"
                    onClick={() => void handleSelectContact(contact)}
                    disabled={startingChat === contact.email}
                    className="w-full flex items-center justify-between p-2 rounded-xl hover:bg-[var(--app-bg-subtle)]/40 transition-colors text-left border border-transparent hover:border-[var(--card-border)] cursor-pointer disabled:opacity-50"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <UserAvatar profile={{ name: contact.name || contact.email, avatar: contact.photoURL }} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-theme-primary truncate">
                          {contact.name || contact.email.split('@')[0]}
                        </p>
                        <p className="text-[11px] text-theme-tertiary font-mono truncate">{contact.email}</p>
                      </div>
                    </div>
                    {startingChat === contact.email ? (
                      <LoaderCircle className="w-4 h-4 animate-spin text-theme-tertiary shrink-0" />
                    ) : (
                      <MessageSquare className="w-4 h-4 text-theme-tertiary shrink-0" />
                    )}
                  </button>
                ))
              ) : !directoryLoading ? (
                <p className="text-xs text-theme-tertiary italic p-3">
                  {searchInput.trim().length < GLOBAL_DIRECTORY_MIN_CHARS
                    ? 'Type at least 3 characters to search the global directory...'
                    : 'No users found matching that search.'}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 bg-[var(--app-bg-subtle)]/40 border-t theme-divider flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl border theme-border text-xs font-semibold text-theme-secondary hover:bg-[var(--app-bg-subtle)] cursor-pointer"
          >
            Cancel
          </button>
        </div>

      </div>
    </div>
  );
}
