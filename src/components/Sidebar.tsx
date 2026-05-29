import { useState } from 'react';
import { useStore } from '@/store';
import {
  Home, FileText, Tag, Star, Archive, Trash2,
  Bell, Search, Settings, Plus, ChevronDown, ChevronRight,
  Moon, Sun, LayoutTemplate, LogOut, X, Share2,
  PanelLeftClose, PanelLeftOpen, GitBranch, FolderSearch
} from 'lucide-react';
import type { SidebarView } from '@/types';
import ManageNotebooksModal from './ManageNotebooksModal';
import { signOut } from 'firebase/auth';
import { auth } from '@/utils/firebase';
import BrandMark from './BrandMark';

export default function Sidebar() {
  const {
    currentView, setCurrentView, profile, settings, setTheme,
    notebooks, tags, sidebarOpen, setSidebarOpen,
    createNotebook, selectNotebook, selectTag,
    notes, getStats, updateSettings, clearAuth,
  } = useStore();

  const [notebooksExpanded, setNotebooksExpanded] = useState(true);
  const [tagsExpanded, setTagsExpanded] = useState(true);
  const [newNotebookName, setNewNotebookName] = useState('');
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [showManageNotebooks, setShowManageNotebooks] = useState(false);

  const stats = getStats();
  const trashedCount = notes.filter(n => n.trashed).length;
  const archivedCount = notes.filter(n => n.archived && !n.trashed).length;
  const starredCount = notes.filter(n => n.starred && !n.trashed && !n.archived).length;
  const remindersCount = notes.filter(n => n.reminder && !n.trashed).length;
  const collapsed = settings.sidebarCollapsed;

  const navItems: { view: SidebarView; icon: typeof Home; label: string; badge?: number }[] = [
    { view: 'home', icon: Home, label: 'Home' },
    { view: 'all-notes', icon: FileText, label: 'All Notes', badge: stats.notes },
    { view: 'search', icon: Search, label: 'Search' },
    { view: 'starred', icon: Star, label: 'Starred', badge: starredCount || undefined },
    { view: 'reminders', icon: Bell, label: 'Reminders', badge: remindersCount || undefined },
    { view: 'shared', icon: Share2, label: 'Shared' },
    { view: 'smart-folders', icon: FolderSearch, label: 'Smart Folders' },
    { view: 'graph', icon: GitBranch, label: 'Graph' },
    { view: 'templates', icon: LayoutTemplate, label: 'Templates' },
    { view: 'archived', icon: Archive, label: 'Archived', badge: archivedCount || undefined },
    { view: 'trash', icon: Trash2, label: 'Trash', badge: trashedCount || undefined },
  ];

  const handleCreateNotebook = () => {
    if (newNotebookName.trim()) {
      createNotebook(newNotebookName.trim());
      setNewNotebookName('');
      setShowNewNotebook(false);
    }
  };

  const handleNavClick = (view: SidebarView) => {
    setCurrentView(view);
    if (window.innerWidth < 1024) setSidebarOpen(false);
  };

  const handleLogout = async () => {
    await signOut(auth).catch(console.error);
    clearAuth();
  };

  return (
    <>
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed lg:relative z-50 h-full flex flex-col w-72
          ${collapsed ? 'lg:w-20' : 'lg:w-72'}
          theme-sidebar
          border-r transition-[width,transform] duration-300 ease-in-out
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={{
          backgroundColor: 'var(--sidebar-bg)',
          borderColor: 'var(--sidebar-border)',
        }}
      >
        {/* Header */}
        <div className={`relative flex items-center justify-between p-4 theme-divider border-b ${collapsed ? 'lg:justify-center lg:px-3' : ''}`}>
          <div className={`flex items-center gap-3 ${collapsed ? 'lg:justify-center' : ''}`}>
            <BrandMark className="w-9 h-9" />
            <div className={collapsed ? 'lg:hidden' : ''}>
              <h1 className="text-base font-bold text-theme-primary">NTK Note</h1>
              <p className="text-xs text-theme-tertiary truncate max-w-[140px]">{profile.email || profile.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => updateSettings({ sidebarCollapsed: !collapsed })}
            className={`hidden lg:inline-flex p-1.5 rounded-lg theme-hover text-theme-tertiary ${collapsed ? 'lg:absolute lg:right-2 lg:top-4' : ''}`}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen className="w-5 h-5 no-transition" /> : <PanelLeftClose className="w-5 h-5 no-transition" />}
          </button>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 rounded-lg theme-hover text-theme-tertiary"
            aria-label="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-2 px-2">
          {/* Main nav */}
          <div className="space-y-0.5">
            {navItems.map(item => (
              <button
                key={item.view}
                onClick={() => handleNavClick(item.view)}
                title={collapsed ? item.label : undefined}
                aria-label={item.label}
                className={`
                  w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all
                  ${collapsed ? 'lg:justify-center lg:px-0' : ''}
                  ${currentView === item.view
                    ? 'theme-active'
                    : 'text-theme-secondary theme-hover'
                  }
                `}
                style={currentView === item.view ? { backgroundColor: 'var(--active-bg)' } : {}}
              >
                <item.icon className="w-[18px] h-[18px] shrink-0 no-transition" />
                <span className={`flex-1 text-left ${collapsed ? 'lg:hidden' : ''}`}>{item.label}</span>
                {item.badge !== undefined && item.badge > 0 && (
                  <span
                    className={`text-xs font-medium px-2 py-0.5 rounded-full ${collapsed ? 'lg:hidden' : ''}`}
                    style={{
                      backgroundColor: currentView === item.view ? 'var(--accent-glow)' : 'var(--input-bg)',
                      color: currentView === item.view ? 'var(--badge-text)' : 'var(--text-tertiary)',
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Notebooks */}
          <div className={`mt-4 pt-4 border-t theme-divider ${collapsed ? 'lg:hidden' : ''}`}>
            <div className="flex items-center px-3 py-2 text-xs font-semibold text-theme-tertiary uppercase tracking-wider">
              <button
                type="button"
                onClick={() => setNotebooksExpanded(!notebooksExpanded)}
                className="flex flex-1 items-center justify-between"
              >
                <span>Notebooks</span>
                {notebooksExpanded ? <ChevronDown className="w-3.5 h-3.5 no-transition" /> : <ChevronRight className="w-3.5 h-3.5 no-transition" />}
              </button>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowManageNotebooks(true)}
                  className="p-0.5 rounded theme-hover"
                  title="Manage notebooks"
                  aria-label="Manage notebooks"
                >
                  <Settings className="w-3.5 h-3.5 no-transition" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowNewNotebook(!showNewNotebook)}
                  className="p-0.5 rounded theme-hover"
                  title="New notebook"
                  aria-label="New notebook"
                >
                  <Plus className="w-3.5 h-3.5 no-transition" />
                </button>
              </div>
            </div>

            {showNewNotebook && (
              <div className="px-3 pb-2">
                <input
                  type="text"
                  value={newNotebookName}
                  onChange={e => setNewNotebookName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateNotebook()}
                  onBlur={() => { if (!newNotebookName.trim()) setShowNewNotebook(false); }}
                  placeholder="New notebook name..."
                  className="w-full px-3 py-1.5 text-sm rounded-lg theme-input accent-focus focus:outline-none"
                  autoFocus
                />
              </div>
            )}

            {notebooksExpanded && (
              <div className="space-y-0.5">
                {notebooks.filter(nb => !nb.parentId && !nb.trashed).map(nb => {
                  const childNotebooks = notebooks.filter(sub => sub.parentId === nb.id && !sub.trashed);
                  const noteCount = notes.filter(n => n.notebookId === nb.id && !n.trashed).length;
                  const isSelected = currentView === 'notebooks' && useStore.getState().selectedNotebookId === nb.id;
                  
                  return (
                    <div key={nb.id} className="group">
                      <div className="flex items-center">
                        <button
                          onClick={() => { selectNotebook(nb.id); handleNavClick('notebooks'); }}
                          className={`
                            flex-1 flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all
                            ${isSelected
                              ? 'font-medium'
                              : 'text-theme-secondary theme-hover'
                            }
                          `}
                          style={isSelected ? { backgroundColor: 'var(--active-bg)', color: 'var(--badge-text)' } : {}}
                        >
                          <span className="text-base">{nb.icon}</span>
                          <span className="flex-1 text-left truncate">{nb.name}</span>
                          <span className="text-xs text-theme-tertiary">{noteCount}</span>
                        </button>
                        {/* Add sub-notebook button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const name = prompt('Sub-notebook name:');
                            if (name?.trim()) {
                              createNotebook(name.trim(), nb.id, '📁');
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 mr-1 rounded theme-hover text-theme-tertiary transition-all"
                          title="Add sub-notebook"
                        >
                          <Plus className="w-3 h-3 no-transition" />
                        </button>
                      </div>
                      {/* Sub-notebooks */}
                      {childNotebooks.map(sub => {
                        const subSelected = currentView === 'notebooks' && useStore.getState().selectedNotebookId === sub.id;
                        const subCount = notes.filter(n => n.notebookId === sub.id && !n.trashed).length;
                        return (
                          <button
                            key={sub.id}
                            onClick={() => { selectNotebook(sub.id); handleNavClick('notebooks'); }}
                            className={`
                              w-full flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-xl text-sm transition-all
                              ${subSelected
                                ? 'font-medium'
                                : 'text-theme-tertiary theme-hover'
                              }
                            `}
                            style={subSelected ? { backgroundColor: 'var(--active-bg)', color: 'var(--badge-text)' } : {}}
                          >
                            <span className="text-sm">{sub.icon}</span>
                            <span className="flex-1 text-left truncate">{sub.name}</span>
                            <span className="text-xs text-theme-tertiary">{subCount}</span>
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tags */}
          <div className={`mt-4 pt-4 border-t theme-divider ${collapsed ? 'lg:hidden' : ''}`}>
            <button
              onClick={() => setTagsExpanded(!tagsExpanded)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-theme-tertiary uppercase tracking-wider"
            >
              <span>Tags</span>
              {tagsExpanded ? <ChevronDown className="w-3.5 h-3.5 no-transition" /> : <ChevronRight className="w-3.5 h-3.5 no-transition" />}
            </button>
            {tagsExpanded && (
              <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                {tags.length === 0 && (
                  <p className="text-xs text-theme-tertiary py-1">No tags yet</p>
                )}
                {tags.map(tag => {
                  const isActive = currentView === 'tags' && useStore.getState().selectedTagId === tag.id;
                  return (
                    <button
                      key={tag.id}
                      onClick={() => { selectTag(tag.id); handleNavClick('tags'); }}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                      style={{
                        backgroundColor: isActive ? 'var(--active-bg)' : 'var(--input-bg)',
                        color: isActive ? 'var(--badge-text)' : 'var(--text-secondary)',
                      }}
                    >
                      <Tag className="w-3 h-3 no-transition" />
                      {tag.name}
                      <span className="text-theme-tertiary">({tag.count})</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        {/* Footer */}
        <div className={`p-3 border-t theme-divider space-y-1 ${collapsed ? 'lg:px-2' : ''}`}>
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(settings.theme === 'light' ? 'dark' : 'light')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-theme-secondary theme-hover transition-all group ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}
            title={settings.theme === 'light' ? 'Dark Mode' : 'Light Mode'}
            aria-label={settings.theme === 'light' ? 'Dark Mode' : 'Light Mode'}
          >
            {settings.theme === 'light' ? (
              <Moon className="w-[18px] h-[18px] no-transition" />
            ) : (
              <Sun className="w-[18px] h-[18px] no-transition group-hover:text-amber-400" />
            )}
            <span className={`font-medium ${collapsed ? 'lg:hidden' : ''}`}>{settings.theme === 'light' ? 'Dark Mode' : 'Light Mode'}</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => handleNavClick('settings')}
            title="Settings"
            aria-label="Settings"
            className={`
              w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm transition-all
              ${collapsed ? 'lg:justify-center lg:px-0' : ''}
              ${currentView === 'settings'
                ? 'font-medium'
                : 'text-theme-secondary theme-hover'
              }
            `}
            style={currentView === 'settings' ? { backgroundColor: 'var(--active-bg)', color: 'var(--badge-text)' } : {}}
          >
            <Settings className="w-[18px] h-[18px] no-transition" />
            <span className={collapsed ? 'lg:hidden' : ''}>Settings</span>
          </button>

          {/* User profile */}
          <div className={`flex items-center gap-3 px-3 py-2 mt-1 ${collapsed ? 'lg:justify-center lg:px-0' : ''}`}>
            <div className="w-8 h-8 rounded-full accent-gradient flex items-center justify-center text-white text-xs font-bold shadow-lg">
              {profile.initials}
            </div>
            <div className={`flex-1 min-w-0 ${collapsed ? 'lg:hidden' : ''}`}>
              <p className="text-sm font-medium text-theme-primary truncate">{profile.name}</p>
              <p className="text-xs text-theme-tertiary truncate">{profile.email || 'Free Plan'}</p>
            </div>
            <button
              onClick={handleLogout}
              className={`p-1.5 rounded-lg theme-hover text-theme-tertiary ${collapsed ? 'lg:hidden' : ''}`}
              title="Log out"
            >
              <LogOut className="w-4 h-4 no-transition" />
            </button>
          </div>
        </div>
      </aside>
      <ManageNotebooksModal isOpen={showManageNotebooks} onClose={() => setShowManageNotebooks(false)} />
    </>
  );
}
