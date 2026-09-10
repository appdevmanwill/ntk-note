import { useState } from 'react';
import { useStore } from '@/store';
import { FolderOpen, Home, MoreHorizontal, Plus, Search } from 'lucide-react';
import CreateSheet from './CreateSheet';

const navItems = [
  { view: 'home', icon: Home, label: 'Home' },
  { view: 'search', icon: Search, label: 'Search' },
  { view: 'folders', icon: FolderOpen, label: 'Folders' },
  { view: 'more', icon: MoreHorizontal, label: 'More' },
] as const;

export default function MobileNav() {
  const { setCurrentView, currentView, editingNote, sidebarOpen } = useStore();
  const [createOpen, setCreateOpen] = useState(false);

  // Keep the editor full-screen on phones: no bottom nav covering content.
  if (editingNote) return null;

  return (
    <>
      <div
        className="fixed bottom-0 left-0 right-0 z-30 lg:hidden safe-bottom"
        style={{ backgroundColor: 'var(--sidebar-bg)' }}
        inert={sidebarOpen || undefined}
      >
        <div className="flex items-center justify-around border-t theme-divider px-2 py-1">
          {navItems.slice(0, 2).map(item => (
            <NavBtn
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={currentView === item.view}
              onClick={() => setCurrentView(item.view)}
            />
          ))}

          {/* Central create control */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-14 w-14 -mt-6 items-center justify-center rounded-2xl accent-gradient text-white shadow-xl transition-all active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 no-transition"
            aria-label="Create new note"
            aria-haspopup="dialog"
          >
            <Plus className="h-7 w-7 no-transition" aria-hidden="true" />
          </button>

          {navItems.slice(2).map(item => (
            <NavBtn
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={currentView === item.view}
              onClick={() => setCurrentView(item.view)}
            />
          ))}
        </div>
      </div>

      <CreateSheet isOpen={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function NavBtn({ icon: Icon, label, active, onClick }: {
  icon: typeof Home; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className="flex min-w-16 flex-col items-center gap-0.5 rounded-xl px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
      style={{ color: active ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
    >
      <Icon className="h-5 w-5 no-transition" aria-hidden="true" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
