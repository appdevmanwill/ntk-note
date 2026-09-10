import { useState } from 'react';
import { useStore } from '@/store';
import { FileText, Home, MoreHorizontal, Plus, Search } from 'lucide-react';
import type { SidebarView } from '@/types';
import CreateSheet from './CreateSheet';

interface NavDestination {
  view: SidebarView;
  icon: typeof Home;
  label: string;
}

const leftNavItems: NavDestination[] = [
  { view: 'home', icon: Home, label: 'Home' },
  { view: 'all-notes', icon: FileText, label: 'Notes' },
];

const rightNavItems: NavDestination[] = [
  { view: 'search', icon: Search, label: 'Search' },
  { view: 'more', icon: MoreHorizontal, label: 'More' },
];

/**
 * Native mobile bottom navigation bar (phone viewports).
 * Exposes 5 high-frequency thumb-reachable actions: Home, Notes, Create, Search, More.
 * Hides automatically during full-screen note writing or active chat to preserve viewport height.
 */
export default function MobileNav() {
  const { setCurrentView, currentView, editingNote, activeChatId, sidebarOpen } = useStore();
  const [createOpen, setCreateOpen] = useState(false);

  // Keep full-screen writing and active chat free of bottom chrome on phones.
  if (editingNote || activeChatId) return null;

  return (
    <>
      <nav
        aria-label="Mobile primary navigation"
        className="fixed bottom-0 left-0 right-0 z-30 lg:hidden safe-bottom"
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom))',
        }}
        inert={sidebarOpen || undefined}
      >
        <div className="flex items-center justify-around border-t theme-divider px-2 py-1 max-w-lg mx-auto">
          {leftNavItems.map(item => (
            <NavBtn
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={currentView === item.view}
              onClick={() => setCurrentView(item.view)}
            />
          ))}

          {/* Central Thumb-Reachable Create Action */}
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="flex h-13 w-13 -mt-5 items-center justify-center rounded-2xl accent-gradient text-white shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 no-transition shrink-0"
            aria-label="Create new item"
            aria-haspopup="dialog"
            title="Create"
          >
            <Plus className="h-6 w-6 no-transition" aria-hidden="true" />
          </button>

          {rightNavItems.map(item => (
            <NavBtn
              key={item.view}
              icon={item.icon}
              label={item.label}
              active={currentView === item.view}
              onClick={() => setCurrentView(item.view)}
            />
          ))}
        </div>
      </nav>

      <CreateSheet isOpen={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function NavBtn({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Home;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      className="flex min-w-[56px] min-h-[48px] flex-col items-center justify-center gap-0.5 rounded-xl px-2.5 py-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70"
      style={{ color: active ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
    >
      <Icon className="h-5 w-5 no-transition" aria-hidden="true" />
      <span className="text-[10px] font-semibold leading-tight">{label}</span>
    </button>
  );
}
