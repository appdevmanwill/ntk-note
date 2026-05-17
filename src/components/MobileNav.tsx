import { useStore } from '@/store';
import { Home, FileText, Plus, Search, Menu } from 'lucide-react';

export default function MobileNav() {
  const { setCurrentView, currentView, createNote, setSidebarOpen, editingNote } = useStore();

  if (editingNote) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden safe-bottom">
      <div
        className="theme-glass border-t theme-divider"
        style={{
          backgroundColor: 'var(--glass-bg)',
          borderColor: 'var(--divider)',
          backdropFilter: 'blur(16px) saturate(180%)',
        }}
      >
        <div className="flex items-center justify-around px-2 py-1">
          <NavBtn icon={Home} label="Home" active={currentView === 'home'} onClick={() => setCurrentView('home')} />
          <NavBtn icon={FileText} label="Notes" active={currentView === 'all-notes'} onClick={() => setCurrentView('all-notes')} />
          
          {/* FAB */}
          <button
            onClick={() => createNote({})}
            className="w-14 h-14 -mt-6 rounded-2xl accent-gradient text-white shadow-xl flex items-center justify-center active:scale-95 transition-all no-transition"
          >
            <Plus className="w-7 h-7 no-transition" />
          </button>

          <NavBtn icon={Search} label="Search" active={currentView === 'search'} onClick={() => setCurrentView('search')} />
          <NavBtn icon={Menu} label="Menu" active={false} onClick={() => setSidebarOpen(true)} />
        </div>
      </div>
    </div>
  );
}

function NavBtn({ icon: Icon, label, active, onClick }: {
  icon: typeof Home; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 px-3 py-2 rounded-xl transition-colors"
      style={{ color: active ? 'var(--accent-primary)' : 'var(--text-tertiary)' }}
    >
      <Icon className="w-5 h-5 no-transition" />
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}
