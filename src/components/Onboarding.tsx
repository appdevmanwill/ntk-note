import { useState } from 'react';
import { useStore } from '@/store';
import {
  FileText, CheckSquare, Palette, Tag, Search, Moon, Sun,
  FolderOpen, ArrowRight, Sparkles, Shield,
  Globe, Brain, Layers, Star,
  Bell, LogIn
} from 'lucide-react';
import { signInWithPopup, signInAnonymously } from 'firebase/auth';
import { auth, googleProvider } from '@/utils/firebase';
import BrandMark from './BrandMark';

export default function Onboarding() {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const { settings, setTheme, completeOnboarding } = useStore();

  const handleSignIn = async () => {
    setLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Error signing in:', error);
      setLoading(false);
    }
  };

  const handleGuestSignIn = async () => {
    setGuestLoading(true);
    try {
      await Promise.race([
        signInAnonymously(auth),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Guest sign-in timed out')), 5000);
        }),
      ]);
    } catch (error) {
      console.warn('Anonymous sync is unavailable, continuing in local guest mode:', error);
      completeOnboarding('Guest');
      setGuestLoading(false);
    }
  };

  return (
    <div className="min-h-dvh overflow-auto theme-bg text-theme-primary transition-colors duration-300">
      {step === 0 && (
        <div className="min-h-full animate-fade-in">
          {/* Nav bar */}
          <nav className="flex items-center justify-between px-6 md:px-12 py-4">
            <div className="flex items-center gap-2">
              <BrandMark className="w-8 h-8" />
              <span className="text-lg font-bold text-theme-primary">NTK Note</span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setTheme(settings.theme === 'light' ? 'dark' : 'light')}
                className="p-2 rounded-full bg-surface-200 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-300 dark:hover:bg-surface-700 transition-colors"
                title={`Switch to ${settings.theme === 'light' ? 'Dark' : 'Light'} Mode`}
              >
                {settings.theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
              <button
                onClick={() => setStep(1)}
                className="px-5 py-2 rounded-full bg-surface-900 dark:bg-white text-white dark:text-surface-900 text-sm font-semibold hover:bg-surface-800 dark:hover:bg-surface-100 transition-colors"
              >
                Sign In
              </button>
            </div>
          </nav>

          {/* Hero Section */}
          <section className="relative px-6 md:px-12 pt-16 pb-24 text-center overflow-hidden">
            <div className="absolute inset-0 opacity-50" style={{ background: 'linear-gradient(180deg, var(--active-bg), transparent 68%)' }} />
            <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'linear-gradient(135deg, currentColor 1px, transparent 1px)', backgroundSize: '32px 32px', color: 'var(--divider)' }} />
            
            <div className="relative max-w-4xl mx-auto">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-indigo-500/10 dark:bg-indigo-500/20 border border-indigo-500/20 dark:border-indigo-500/30 text-indigo-600 dark:text-indigo-300 text-sm font-medium mb-6">
                <Sparkles className="w-4 h-4" />
                The Ultimate Note-Taking Experience
              </div>
              
              <h1 className="text-4xl md:text-6xl lg:text-7xl font-black text-theme-primary tracking-tight leading-[1.1] mb-6">
                Tame your work,{' '}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 dark:from-indigo-400 dark:via-purple-400 dark:to-pink-400">
                  organize your life
                </span>
              </h1>
              
              <p className="text-lg md:text-xl text-surface-600 dark:text-surface-400 max-w-2xl mx-auto mb-10 leading-relaxed">
                Remember everything. Capture ideas, manage tasks, and organize your knowledge — 
                all in one beautiful, powerful app with seamless cloud sync.
              </p>

              <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-12">
                <button
                  onClick={() => setStep(1)}
                  className="w-full sm:w-auto px-8 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold text-lg hover:from-indigo-500 hover:to-purple-500 transition-all shadow-xl shadow-indigo-500/25 flex items-center justify-center gap-2"
                >
                  Sign In <ArrowRight className="w-5 h-5" />
                </button>
                <p className="text-surface-500 dark:text-surface-500 text-sm">Sync across all your devices</p>
              </div>

              {/* App Preview Mock */}
              <div className="relative max-w-3xl mx-auto">
                <div className="rounded-2xl theme-card border overflow-hidden">
                  {/* Mock titlebar */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b theme-divider">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-red-500/80" />
                      <div className="w-3 h-3 rounded-full bg-yellow-500/80" />
                      <div className="w-3 h-3 rounded-full bg-green-500/80" />
                    </div>
                    <div className="flex-1 text-center text-xs text-surface-500">NTK Note</div>
                  </div>
                  {/* Mock content */}
                  <div className="flex h-72">
                    {/* Sidebar mock */}
                    <div className="w-52 border-r theme-divider p-3 hidden md:block">
                      <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-indigo-500/10 dark:bg-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-xs font-medium mb-2">
                        <div className="w-4 h-4 rounded bg-indigo-500/20 dark:bg-indigo-500/30" />
                        Home
                      </div>
                      {['All Notes', 'Notebooks', 'Tags', 'Reminders', 'Starred'].map((item, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-surface-600 dark:text-surface-500 text-xs">
                          <div className="w-4 h-4 rounded bg-surface-200 dark:bg-surface-700" />
                          {item}
                        </div>
                      ))}
                    </div>
                    {/* Notes mock */}
                    <div className="flex-1 p-3">
                      <div className="text-surface-800 dark:text-surface-300 text-sm font-semibold mb-3">Good morning 👋</div>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { color: 'bg-indigo-50 dark:bg-indigo-500/20 border-indigo-200 dark:border-indigo-500/30', title: 'Meeting Notes' },
                          { color: 'bg-green-50 dark:bg-green-500/20 border-green-200 dark:border-green-500/30', title: 'Weekly Goals' },
                          { color: 'bg-amber-50 dark:bg-amber-500/20 border-amber-200 dark:border-amber-500/30', title: 'Ideas ✨' },
                          { color: 'bg-pink-50 dark:bg-pink-500/20 border-pink-200 dark:border-pink-500/30', title: 'Shopping List' },
                        ].map((card, i) => (
                          <div key={i} className={`p-2.5 rounded-lg border ${card.color}`}>
                            <div className="text-xs font-medium text-surface-800 dark:text-surface-300 mb-1">{card.title}</div>
                            <div className="space-y-1">
                              <div className="h-1.5 bg-surface-300 dark:bg-surface-600/50 rounded w-full" />
                              <div className="h-1.5 bg-surface-300 dark:bg-surface-600/50 rounded w-3/4" />
                              <div className="h-1.5 bg-surface-300 dark:bg-surface-600/50 rounded w-1/2" />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Glow effect */}
                <div className="absolute -inset-4 bg-gradient-to-t from-surface-50 dark:from-surface-950 via-transparent to-transparent pointer-events-none" />
              </div>
            </div>
          </section>

          {/* Features Grid */}
          <section className="px-6 md:px-12 py-20 relative">
            <div className="max-w-5xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-bold text-theme-primary mb-4">Everything you need, nothing you don't</h2>
                <p className="text-surface-600 dark:text-surface-400 text-lg max-w-2xl mx-auto">
                  Combining the best of Evernote, Google Keep, Simplenote, and OneNote into one powerful app.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { icon: FileText, title: 'Rich Text Editor', desc: 'Bold, italic, headings, lists, quotes, code blocks — everything you need for beautiful notes.', color: 'from-blue-500 to-indigo-500' },
                  { icon: CheckSquare, title: 'Smart Checklists', desc: 'Interactive to-do lists with progress tracking. Drag to reorder, check to complete.', color: 'from-green-500 to-emerald-500' },
                  { icon: Palette, title: '12 Note Colors', desc: 'Color-code your notes like Google Keep for instant visual organization.', color: 'from-pink-500 to-rose-500' },
                  { icon: FolderOpen, title: 'Notebooks & Sections', desc: 'Organize notes into notebooks with sections, just like OneNote.', color: 'from-amber-500 to-orange-500' },
                  { icon: Tag, title: 'Tags & Labels', desc: 'Add unlimited tags for powerful cross-referencing like Evernote.', color: 'from-purple-500 to-violet-500' },
                  { icon: Search, title: 'Instant Search', desc: 'Lightning-fast search across all notes, titles, content, and tags.', color: 'from-cyan-500 to-blue-500' },
                  { icon: Moon, title: 'Dark Mode', desc: 'Beautiful dark theme with 12 premium accent color options.', color: 'from-indigo-500 to-purple-500' },
                  { icon: Bell, title: 'Reminders', desc: 'Set time-based reminders with browser notifications.', color: 'from-orange-500 to-red-500' },
                  { icon: Globe, title: 'Cross-Device Sync', desc: 'Powered by Firebase. Your notes sync instantly across all your devices.', color: 'from-blue-400 to-cyan-500' },
                  { icon: Brain, title: 'Markdown Support', desc: 'Full markdown with live preview for developers and writers.', color: 'from-violet-500 to-purple-500' },
                  { icon: Layers, title: 'Templates', desc: 'Pre-built templates for meetings, journals, projects, and more.', color: 'from-rose-500 to-pink-500' },
                  { icon: Shield, title: 'Privacy First', desc: 'Secure authentication and offline-first capabilities for your peace of mind.', color: 'from-emerald-500 to-teal-500' },
                ].map((feature, i) => (
                  <div
                    key={i}
                    className="group p-5 rounded-2xl theme-card border hover:shadow-lg transition-all duration-300"
                  >
                    <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feature.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                      <feature.icon className="w-5 h-5 text-white" />
                    </div>
                    <h3 className="font-semibold text-theme-primary mb-1">{feature.title}</h3>
                    <p className="text-sm text-surface-600 dark:text-surface-400 leading-relaxed">{feature.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* CTA */}
          <section className="px-6 md:px-12 py-20">
            <div className="max-w-2xl mx-auto text-center">
              <BrandMark className="w-16 h-16 mx-auto mb-6 rounded-2xl" />
              <h2 className="text-3xl md:text-4xl font-bold text-theme-primary mb-4">
                Ready to organize your life?
              </h2>
              <p className="text-surface-600 dark:text-surface-400 text-lg mb-8">
                Join thousands who've simplified their note-taking.
              </p>
              <button
                onClick={() => setStep(1)}
                className="px-10 py-4 rounded-2xl bg-gradient-to-r from-indigo-600 to-purple-600 text-white font-semibold text-lg hover:from-indigo-500 hover:to-purple-500 transition-all shadow-xl shadow-indigo-500/25 inline-flex items-center gap-2"
              >
                Sign In Now <ArrowRight className="w-5 h-5" />
              </button>
            </div>
          </section>

          {/* Footer */}
          <footer className="px-6 md:px-12 py-6 border-t theme-divider">
            <div className="max-w-5xl mx-auto flex items-center justify-between text-xs text-surface-500 dark:text-surface-600">
              <div className="flex items-center gap-2">
                <BrandMark className="w-4 h-4 rounded" />
                <span>NTK Note • Your Second Brain</span>
              </div>
              <span>Built with ❤️ for productivity</span>
            </div>
          </footer>
        </div>
      )}

      {step === 1 && (
        <div className="min-h-full flex items-center justify-center p-6 animate-fade-in relative">
          <div className="absolute top-4 right-6">
             <button
                onClick={() => setTheme(settings.theme === 'light' ? 'dark' : 'light')}
                className="p-2 rounded-full bg-surface-200 dark:bg-surface-800 text-surface-600 dark:text-surface-300 hover:bg-surface-300 dark:hover:bg-surface-700 transition-colors"
                title={`Switch to ${settings.theme === 'light' ? 'Dark' : 'Light'} Mode`}
              >
                {settings.theme === 'light' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
              </button>
          </div>
          <div className="w-full max-w-md">
            <div className="text-center mb-8">
              <BrandMark className="w-16 h-16 mx-auto mb-4 rounded-2xl" />
              <h2 className="text-3xl font-bold text-theme-primary">Welcome to NTK Note</h2>
              <p className="text-surface-600 dark:text-surface-400 mt-2">Sign in to sync your notes</p>
            </div>

            <div className="theme-card border rounded-2xl p-6 space-y-5">
              <button
                onClick={handleSignIn}
                disabled={loading || guestLoading}
                className="w-full py-4 rounded-xl bg-surface-900 dark:bg-white text-white dark:text-surface-900 font-semibold text-lg hover:bg-surface-800 dark:hover:bg-surface-100 transition-all shadow-xl flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  <span className="w-5 h-5 border-2 border-white dark:border-surface-900 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <img src="https://www.google.com/favicon.ico" alt="Google" className="w-5 h-5" />
                    Sign in with Google
                  </>
                )}
              </button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t theme-divider"></div>
                </div>
                <div className="relative flex justify-center text-sm">
                  <span className="px-2 text-surface-500" style={{ backgroundColor: 'var(--card-bg)' }}>Or</span>
                </div>
              </div>

              <button
                onClick={handleGuestSignIn}
                disabled={loading || guestLoading}
                className="w-full py-4 rounded-xl bg-surface-100 dark:bg-surface-700 text-surface-900 dark:text-white font-semibold text-lg hover:bg-surface-200 dark:hover:bg-surface-600 transition-all shadow-md flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed border border-surface-200 dark:border-surface-600"
              >
                {guestLoading ? (
                  <span className="w-5 h-5 border-2 border-surface-900 dark:border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    <LogIn className="w-5 h-5" />
                    Continue as Guest
                  </>
                )}
              </button>
            </div>

            <button
              onClick={() => setStep(0)}
              className="w-full mt-4 py-2 text-surface-500 hover:text-surface-900 dark:hover:text-white text-sm transition-colors"
            >
              ← Back to overview
            </button>

            <div className="flex items-center justify-center gap-4 mt-6 text-xs text-surface-500 dark:text-surface-600">
              <span className="flex items-center gap-1"><Shield className="w-3 h-3" /> Secure</span>
              <span className="flex items-center gap-1"><Globe className="w-3 h-3" /> Synced</span>
              <span className="flex items-center gap-1"><Star className="w-3 h-3" /> Fast</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
