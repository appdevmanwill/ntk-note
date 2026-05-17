import { useStore } from '@/store';
import type { Note } from '@/types';
import { noteColors } from '@/utils/colors';
import {
  Star, Pin, Archive, Trash2, MoreVertical, Clock,
  FileText, CheckSquare, Type, Bell, Undo2, Lock
} from 'lucide-react';
import { format } from 'date-fns';
import { useState, useRef, useEffect } from 'react';

const typeIcons = {
  note: FileText,
  checklist: CheckSquare,
  markdown: Type,
};

export default function NoteCard({ note, compact = false }: { note: Note; compact?: boolean }) {
  const {
    selectNote, starNote, pinNote, archiveNote,
    trashNote, restoreNote, deleteNote, settings,
  } = useStore();

  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const noteColor = note.color ? noteColors[note.color] : null;
  const TypeIcon = typeIcons[note.type || 'note'];
  const DisplayIcon = note.encrypted ? Lock : TypeIcon;
  const noteTheme = note.theme || settings.defaultNoteTheme || 'canvas';
  const densityPadding = compact
    ? settings.density === 'compact' ? 'p-2.5' : settings.density === 'spacious' ? 'p-4' : 'p-3'
    : settings.density === 'compact' ? 'p-3' : settings.density === 'spacious' ? 'p-5' : 'p-4';
  const checklistProgress = note.checklist.length > 0
    ? Math.round((note.checklist.filter(c => c.checked).length / note.checklist.length) * 100)
    : 0;

  const getPreview = () => {
    if (note.encrypted) {
      return (
        <p className="text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--text-tertiary)' }}>
          Locked note
        </p>
      );
    }

    if (note.type === 'checklist' && note.checklist.length > 0) {
      return note.checklist.slice(0, 3).map((item, i) => (
        <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <span className="w-3.5 h-3.5 rounded-sm border flex-shrink-0 flex items-center justify-center"
            style={item.checked ? { backgroundColor: 'var(--accent-primary)', borderColor: 'var(--accent-primary)' } : { borderColor: 'var(--text-muted)' }}>
            {item.checked && <span className="text-white text-[8px]">✓</span>}
          </span>
          <span className={item.checked ? 'line-through' : ''} style={{ color: item.checked ? 'var(--text-muted)' : 'var(--text-secondary)' }}>
            {item.text}
          </span>
        </div>
      ));
    }
    return (
      <p className="text-xs leading-relaxed line-clamp-3" style={{ color: 'var(--text-tertiary)' }}>
        {note.content.replace(/<[^>]*>/g, '').slice(0, 150) || 'Empty note'}
      </p>
    );
  };

  return (
    <div
      className={`
        note-card group relative rounded-xl border cursor-pointer overflow-hidden
        transition-all duration-200 hover:-translate-y-0.5
        ${densityPadding}
      `}
      data-note-color={note.color || 'default'}
      data-note-theme={noteTheme}
      onClick={() => selectNote(note.id)}
      style={{
        backgroundColor: 'var(--note-card-bg)',
        borderColor: 'var(--note-card-border)',
        boxShadow: 'var(--card-shadow)',
      }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = 'var(--card-shadow-hover)')}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = 'var(--card-shadow)')}
    >
      {/* Color indicator strip */}
      {noteColor && noteColor.dot !== 'bg-surface-400' && (
        <div className={`absolute top-0 left-0 right-0 h-0.5 ${noteColor.dot}`} />
      )}

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <DisplayIcon
            className="w-4 h-4 shrink-0 no-transition"
            style={{ color: 'var(--text-tertiary)' }}
          />
          <h3
            className={`font-semibold truncate ${compact ? 'text-sm' : 'text-base'}`}
            style={{ color: 'var(--text-primary)' }}
          >
            {note.title || 'Untitled'}
          </h3>
        </div>

        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
          {note.starred && <Star className="w-4 h-4 fill-amber-400 text-amber-400 no-transition" />}
          {note.pinned && <Pin className="w-4 h-4 accent-text no-transition" />}
          {note.reminder && <Bell className="w-3.5 h-3.5 text-orange-400 no-transition" />}

          <div className="relative" ref={menuRef}>
            <button
              onClick={(e) => { e.stopPropagation(); setShowMenu(!showMenu); }}
              className="p-1 rounded-lg theme-hover"
              style={{ color: 'var(--text-tertiary)' }}
            >
              <MoreVertical className="w-4 h-4 no-transition" />
            </button>

            {showMenu && (
              <div
                className="absolute right-0 top-full mt-1 w-48 rounded-xl border py-1 z-50 animate-scale-in theme-menu"
              >
                {!note.trashed ? (
                  <>
                    <MenuButton onClick={() => { starNote(note.id); setShowMenu(false); }}>
                      <Star className="w-4 h-4 no-transition" /> {note.starred ? 'Unstar' : 'Star'}
                    </MenuButton>
                    <MenuButton onClick={() => { pinNote(note.id); setShowMenu(false); }}>
                      <Pin className="w-4 h-4 no-transition" /> {note.pinned ? 'Unpin' : 'Pin'}
                    </MenuButton>
                    <MenuButton onClick={() => { archiveNote(note.id); setShowMenu(false); }}>
                      <Archive className="w-4 h-4 no-transition" /> {note.archived ? 'Unarchive' : 'Archive'}
                    </MenuButton>
                    <div className="my-1 border-t theme-divider" />
                    <MenuButton onClick={() => { trashNote(note.id); setShowMenu(false); }} danger>
                      <Trash2 className="w-4 h-4 no-transition" /> Move to Trash
                    </MenuButton>
                  </>
                ) : (
                  <>
                    <MenuButton onClick={() => { restoreNote(note.id); setShowMenu(false); }}>
                      <Undo2 className="w-4 h-4 no-transition" /> Restore
                    </MenuButton>
                    <MenuButton onClick={() => { deleteNote(note.id); setShowMenu(false); }} danger>
                      <Trash2 className="w-4 h-4 no-transition" /> Delete Permanently
                    </MenuButton>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Content Preview */}
      <div className="space-y-1.5 mb-3">{getPreview()}</div>

      {/* Checklist Progress */}
      {note.type === 'checklist' && note.checklist.length > 0 && (
        <div className="mb-2">
          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--input-bg)' }}>
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all"
              style={{ width: `${checklistProgress}%` }}
            />
          </div>
          <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
            {note.checklist.filter(c => c.checked).length}/{note.checklist.length} done
          </p>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {note.tags?.slice(0, 2).map(tagId => (
            <span
              key={tagId}
              className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{ backgroundColor: 'var(--badge-bg)', color: 'var(--badge-text)' }}
            >
              #{useStore.getState().tags.find(t => t.id === tagId)?.name || tagId}
            </span>
          ))}
        </div>
        <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <Clock className="w-3 h-3 no-transition" />
          {format(new Date(note.updatedAt), 'MMM d')}
        </div>
      </div>
    </div>
  );
}

function MenuButton({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`
        w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors
        ${danger ? 'text-red-500 hover:bg-red-500/10' : 'theme-hover'}
      `}
      style={!danger ? { color: 'var(--text-secondary)' } : {}}
    >
      {children}
    </button>
  );
}
