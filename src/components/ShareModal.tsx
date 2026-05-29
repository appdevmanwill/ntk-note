import { useState, useEffect, useRef } from 'react';
import { useStore } from '@/store';
import { db } from '@/utils/firebase';
import { collection, getDocs } from 'firebase/firestore';
import { X, UserPlus, Globe, Copy, Check, Users, Trash2, Send, Share2 } from 'lucide-react';
import type { Note, Notebook } from '@/types';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: 'note' | 'notebook';
  entityId: string;
}

export default function ShareModal({ isOpen, onClose, entityType, entityId }: ShareModalProps) {
  const { notes, notebooks, shareNote, shareNotebook, profile } = useStore();

  const note = entityType === 'note' ? notes.find(n => n.id === entityId) : null;
  const notebook = entityType === 'notebook' ? notebooks.find(nb => nb.id === entityId) : null;

  const [emailInput, setEmailInput] = useState('');
  const [usersDirectory, setUsersDirectory] = useState<{ email: string; name: string }[]>([]);
  const [filteredDirectory, setFilteredDirectory] = useState<{ email: string; name: string }[]>([]);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [isPublished, setIsPublished] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      if (note) {
        setSharedWith(note.sharedWith || []);
        setIsPublished(!!note.isPublished);
      } else if (notebook) {
        setSharedWith(notebook.sharedWith || []);
      }
      
      // Load user directory from Firestore
      getDocs(collection(db, 'users_directory'))
        .then(snapshot => {
          const users = snapshot.docs.map(doc => ({
            email: doc.data().email || '',
            name: doc.data().name || ''
          })).filter(u => u.email && u.email !== profile.email);
          setUsersDirectory(users);
        })
        .catch(console.error);
    }
  }, [isOpen, note, notebook, profile.email]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const handleEmailChange = (val: string) => {
    setEmailInput(val);
    if (val.trim()) {
      const filtered = usersDirectory.filter(u =>
        u.email.toLowerCase().includes(val.toLowerCase()) ||
        u.name.toLowerCase().includes(val.toLowerCase())
      );
      setFilteredDirectory(filtered);
      setDropdownOpen(filtered.length > 0);
    } else {
      setDropdownOpen(false);
    }
  };

  const addShareUser = (email: string) => {
    const trimmed = email.trim().toLowerCase();
    if (trimmed && !sharedWith.includes(trimmed) && trimmed !== profile.email) {
      const updated = [...sharedWith, trimmed];
      setSharedWith(updated);
      setEmailInput('');
      setDropdownOpen(false);
      
      // Sync immediately to DB
      if (entityType === 'note') {
        void shareNote(entityId, updated, isPublished);
      } else {
        void shareNotebook(entityId, updated);
      }
    }
  };

  const removeShareUser = (email: string) => {
    const updated = sharedWith.filter(e => e !== email);
    setSharedWith(updated);
    
    // Sync immediately to DB
    if (entityType === 'note') {
      void shareNote(entityId, updated, isPublished);
    } else {
      void shareNotebook(entityId, updated);
    }
  };

  const togglePublicPublish = () => {
    if (entityType !== 'note') return;
    const nextPublished = !isPublished;
    setIsPublished(nextPublished);
    void shareNote(entityId, sharedWith, nextPublished);
  };

  const getPublicUrl = () => {
    return `${window.location.origin}/?p=${entityId}`;
  };

  const copyLink = () => {
    void navigator.clipboard.writeText(getPublicUrl());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Quick social links
  const getWhatsAppLink = () => {
    const text = encodeURIComponent(`Check out my shared note: ${note?.title || 'Untitled Note'} at ${getPublicUrl()}`);
    return `https://api.whatsapp.com/send?text=${text}`;
  };

  const getTelegramLink = () => {
    const url = encodeURIComponent(getPublicUrl());
    const text = encodeURIComponent(`Check out my shared note: ${note?.title || 'Untitled Note'}`);
    return `https://t.me/share/url?url=${url}&text=${text}`;
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-[var(--card-bg)] border theme-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b theme-divider">
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 accent-text" />
            <h3 className="text-lg font-bold text-theme-primary">
              Share {entityType === 'note' ? 'Note' : 'Notebook'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg theme-hover text-theme-tertiary cursor-pointer"
            aria-label="Close share panel"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-6 overflow-y-auto max-h-[75vh]">
          
          {/* User Search & Add */}
          <div className="space-y-2 relative" ref={dropdownRef}>
            <label className="block text-sm font-semibold text-theme-secondary flex items-center gap-1.5">
              <UserPlus className="w-4 h-4 text-theme-tertiary" />
              Share with gmail-registered collaborators
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={emailInput}
                onChange={e => handleEmailChange(e.target.value)}
                onFocus={() => { if (filteredDirectory.length > 0) setDropdownOpen(true); }}
                onKeyDown={e => {
                  if (e.key === 'Enter' && emailInput.trim()) {
                    addShareUser(emailInput);
                  }
                }}
                placeholder="Enter collaborator email..."
                className="flex-1 px-3.5 py-2.5 rounded-xl theme-input border text-sm focus:outline-none accent-focus"
              />
              <button
                onClick={() => addShareUser(emailInput)}
                disabled={!emailInput.trim()}
                className="px-4 py-2.5 rounded-xl accent-button text-sm font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                Add
              </button>
            </div>

            {/* Suggestions Dropdown */}
            {dropdownOpen && (
              <div className="absolute left-0 right-0 top-full mt-1.5 bg-[var(--card-bg)] border theme-border rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto">
                {filteredDirectory.map(u => (
                  <button
                    key={u.email}
                    onClick={() => addShareUser(u.email)}
                    className="w-full text-left px-4 py-2.5 text-xs hover:bg-[var(--app-bg-subtle)]/40 border-b last:border-0 theme-divider flex flex-col gap-0.5"
                  >
                    <span className="font-bold text-theme-primary">{u.name}</span>
                    <span className="text-theme-tertiary font-mono">{u.email}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Shared list */}
          <div className="space-y-2">
            <h4 className="text-xs uppercase font-bold tracking-wider text-theme-tertiary flex items-center gap-1">
              <Users className="w-3.5 h-3.5" />
              Who has access ({sharedWith.length})
            </h4>
            {sharedWith.length === 0 ? (
              <p className="text-xs text-theme-muted italic py-1">Private (Only you can access this)</p>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto">
                {sharedWith.map(email => (
                  <div key={email} className="flex items-center justify-between p-2 rounded-lg bg-[var(--app-bg-subtle)]/20 border theme-border">
                    <span className="text-xs text-theme-primary font-mono truncate mr-2">{email}</span>
                    <button
                      onClick={() => removeShareUser(email)}
                      className="p-1 rounded theme-hover text-theme-tertiary hover:text-red-500 cursor-pointer"
                      title="Remove collaborator"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Public Publishing for Notes */}
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
                  className={`w-10 h-6 rounded-full relative transition-colors cursor-pointer`}
                  style={{ backgroundColor: isPublished ? 'var(--accent-primary)' : 'var(--text-muted)' }}
                  role="switch"
                  aria-checked={isPublished}
                >
                  <div className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${isPublished ? 'translate-x-4' : ''}`} />
                </button>
              </div>

              {isPublished && (
                <div className="space-y-3 p-3.5 rounded-xl border theme-border bg-[var(--app-bg-subtle)]/10 animate-fade-in">
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

                  {/* Social buttons */}
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold text-theme-tertiary tracking-wider mr-1">Share to:</span>
                    <a
                      href={getWhatsAppLink()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg border theme-border bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" />
                      WhatsApp
                    </a>
                    <a
                      href={getTelegramLink()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-2.5 py-1.5 rounded-lg border theme-border bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/20 dark:hover:bg-blue-950/30 text-blue-600 dark:text-blue-400 text-xs font-bold flex items-center gap-1"
                    >
                      <Send className="w-3 h-3" />
                      Telegram
                    </a>
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
