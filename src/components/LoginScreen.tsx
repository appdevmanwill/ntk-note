import { useState } from 'react';
import { useStore } from '@/store';
import { signInWithPopup, signInAnonymously } from 'firebase/auth';
import { auth, googleProvider } from '@/utils/firebase';
import BrandMark from './BrandMark';
import {
  ArrowLeft, FolderOpen, Globe, Loader2, LogIn,
  Monitor, Moon, Shield, ShieldCheck, Star, Sun, Zap,
} from 'lucide-react';

interface LoginScreenProps {
  onBackToOverview: () => void;
}

const friendlyAuthError = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  if (
    code === 'auth/popup-closed-by-request' ||
    code === 'auth/cancelled-popup-request' ||
    code === 'auth/user-cancelled'
  ) {
    return 'The Google sign-in window was closed before finishing. Please try again.';
  }
  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the sign-in window. Allow popups for this site and try again.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network connection unavailable. Check your internet and try again.';
  }
  if (code === 'auth/unauthorized-domain') {
    return 'This domain is not allowed for Google sign-in yet.';
  }
  return 'Sign-in could not be completed. Please try again.';
};

const features = [
  {
    icon: ShieldCheck,
    title: 'Secure Sync',
    text: 'Your notes are encrypted and safely synced across all your devices.',
    container: 'bg-purple-500/10 dark:bg-purple-400/15 text-purple-600 dark:text-purple-300 ring-purple-500/25 dark:ring-purple-400/25',
  },
  {
    icon: Zap,
    title: 'Fast Access',
    text: 'Open, search, and edit your notes in a flash whenever inspiration strikes.',
    container: 'bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-300 ring-blue-500/25 dark:ring-blue-400/25',
  },
  {
    icon: FolderOpen,
    title: 'Smart Organization',
    text: 'Organize with tags, notebooks, and powerful search to find anything instantly.',
    container: 'bg-cyan-500/10 dark:bg-cyan-400/15 text-cyan-600 dark:text-cyan-300 ring-cyan-500/25 dark:ring-cyan-400/25',
  },
];

const trustIndicators = [
  { icon: Shield, label: 'Secure' },
  { icon: Globe, label: 'Synced' },
  { icon: Star, label: 'Fast' },
];

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.69 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z" />
    </svg>
  );
}

/** Light / Dark / System segmented control, persisted via the app's theme store. */
function ThemeSwitch({ className = '' }: { className?: string }) {
  const { settings, setTheme } = useStore();
  const options = [
    { value: 'light', icon: Sun, label: 'Light theme' },
    { value: 'dark', icon: Moon, label: 'Dark theme' },
    { value: 'system', icon: Monitor, label: 'Follow system theme' },
  ] as const;

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={`flex items-center gap-1 rounded-full border border-slate-900/10 bg-white/60 p-1 backdrop-blur dark:border-white/10 dark:bg-white/5 ${className}`}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={settings.theme === option.value}
          aria-label={option.label}
          title={option.label}
          onClick={() => setTheme(option.value)}
          className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 ${
            settings.theme === option.value
              ? 'bg-slate-900 text-white shadow dark:bg-white dark:text-slate-900'
              : 'text-slate-500 hover:bg-slate-900/5 dark:text-slate-400 dark:hover:bg-white/10'
          }`}
        >
          <option.icon className="h-4 w-4" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

/** Decorative hero illustration — layered note cards on a glowing platform. */
function LoginIllustration() {
  return (
    <svg
      viewBox="0 0 560 480"
      className="w-full h-auto"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="ntk-login-card-front" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.34" />
          <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.16" />
        </linearGradient>
        <linearGradient id="ntk-login-card-mid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.10" />
        </linearGradient>
        <linearGradient id="ntk-login-card-back" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#6366f1" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="ntk-login-platform" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#a855f7" />
          <stop offset="55%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
        <linearGradient id="ntk-login-image" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.35" />
        </linearGradient>
        <filter id="ntk-login-soft-glow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="14" />
        </filter>
      </defs>

      {/* Platform glow + base */}
      <g className="login-float-slow">
        <rect x="150" y="356" width="270" height="64" rx="32" fill="none" stroke="url(#ntk-login-platform)" strokeWidth="10" opacity="0.55" filter="url(#ntk-login-soft-glow)" />
        <rect x="150" y="356" width="270" height="64" rx="32" className="fill-slate-700/85 dark:fill-[#0b1330]/85" stroke="url(#ntk-login-platform)" strokeWidth="2.5" />
      </g>

      {/* Back card */}
      <g className="login-float-slow">
        <rect x="316" y="96" width="150" height="196" rx="18" fill="url(#ntk-login-card-back)" stroke="#38bdf8" strokeOpacity="0.35" strokeWidth="1.5" />
        <rect x="336" y="122" width="66" height="9" rx="4.5" fill="#7dd3fc" opacity="0.5" />
        <rect x="336" y="142" width="94" height="7" rx="3.5" fill="#94a3b8" opacity="0.35" />
        <rect x="336" y="158" width="80" height="7" rx="3.5" fill="#94a3b8" opacity="0.28" />
        <rect x="336" y="174" width="88" height="7" rx="3.5" fill="#94a3b8" opacity="0.22" />
        {[206, 228, 250].map((cy, i) => (
          <g key={cy}>
            <circle cx="342" cy={cy} r="7" fill="none" stroke="#38bdf8" strokeOpacity="0.55" strokeWidth="1.6" />
            {i < 2 && <path d={`M339 ${cy} l2.4 2.6 4-5`} stroke="#67e8f9" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
            <rect x="356" y={cy - 3.5} width="72" height="7" rx="3.5" fill="#94a3b8" opacity={0.3 - i * 0.06} />
          </g>
        ))}
      </g>

      {/* Mid card */}
      <g className="login-float-fast">
        <rect x="238" y="128" width="158" height="204" rx="18" fill="url(#ntk-login-card-mid)" stroke="#60a5fa" strokeOpacity="0.4" strokeWidth="1.5" />
        <rect x="258" y="154" width="58" height="9" rx="4.5" fill="#93c5fd" opacity="0.55" />
        <rect x="258" y="174" width="100" height="7" rx="3.5" fill="#94a3b8" opacity="0.35" />
        <rect x="258" y="190" width="86" height="7" rx="3.5" fill="#94a3b8" opacity="0.28" />
        {[216, 238, 260, 282].map((cy, i) => (
          <g key={cy}>
            <circle cx="264" cy={cy} r="7" fill="none" stroke="#60a5fa" strokeOpacity="0.6" strokeWidth="1.6" />
            {i < 3 && <path d={`M261 ${cy} l2.4 2.6 4-5`} stroke="#93c5fd" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
            <rect x="278" y={cy - 3.5} width={i % 2 === 0 ? 78 : 62} height="7" rx="3.5" fill="#94a3b8" opacity={0.32 - i * 0.05} />
          </g>
        ))}
      </g>

      {/* Front card */}
      <g className="login-float-slow">
        <rect x="128" y="170" width="196" height="238" rx="20" fill="url(#ntk-login-card-front)" stroke="#a78bfa" strokeOpacity="0.5" strokeWidth="1.5" />
        <text x="150" y="222" fontFamily="Georgia, serif" fontSize="44" fill="#c4b5fd" opacity="0.85">“</text>
        <rect x="196" y="196" width="86" height="9" rx="4.5" fill="#ddd6fe" opacity="0.6" />
        <rect x="150" y="240" width="128" height="8" rx="4" fill="#cbd5e1" opacity="0.4" />
        <rect x="150" y="257" width="150" height="8" rx="4" fill="#cbd5e1" opacity="0.32" />
        <rect x="150" y="274" width="112" height="8" rx="4" fill="#cbd5e1" opacity="0.26" />
        {/* Image placeholder */}
        <rect x="150" y="300" width="150" height="84" rx="12" fill="url(#ntk-login-image)" opacity="0.5" />
        <circle cx="184" cy="326" r="9" fill="#e0e7ff" opacity="0.8" />
        <path d="M158 372 l30 -26 24 18 22 -20 42 28 z" fill="#c7d2fe" opacity="0.75" />
      </g>

      {/* Ambient particles */}
      <g fill="#67e8f9">
        <circle cx="96" cy="120" r="2.4" opacity="0.5" />
        <circle cx="500" cy="180" r="2" opacity="0.4" />
        <circle cx="452" cy="70" r="1.6" opacity="0.35" />
        <circle cx="70" cy="300" r="1.8" opacity="0.3" />
      </g>
      <g fill="#c4b5fd">
        <circle cx="470" cy="300" r="2.2" opacity="0.45" />
        <circle cx="120" cy="60" r="1.7" opacity="0.4" />
        <circle cx="520" cy="120" r="1.5" opacity="0.3" />
      </g>
    </svg>
  );
}

function BrandLockup({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <BrandMark className={compact ? 'w-9 h-9 rounded-xl' : 'w-10 h-10 rounded-xl'} />
      <div>
        <p className={`${compact ? 'text-lg' : 'text-xl'} font-extrabold tracking-tight leading-tight text-slate-900 dark:text-white`}>
          NTK Note
        </p>
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Your Second Brain</p>
      </div>
    </div>
  );
}

export default function LoginScreen({ onBackToOverview }: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [guestLoading, setGuestLoading] = useState(false);
  const [error, setError] = useState('');
  const authBusy = loading || guestLoading;

  // Real Firebase Google sign-in flow (unchanged behavior).
  const handleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Error signing in:', err);
      setError(friendlyAuthError(err));
    } finally {
      // Successful auth normally unmounts this screen immediately. If dashboard
      // initialization fails for any reason, never strand the user on an
      // indefinite spinner.
      setLoading(false);
    }
  };

  // Real Firebase anonymous sign-in with the existing local-guest fallback.
  const handleGuestSignIn = async () => {
    setGuestLoading(true);
    setError('');
    try {
      await Promise.race([
        signInAnonymously(auth),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Guest sign-in timed out')), 5000);
        }),
      ]);
    } catch (err) {
      console.warn('Anonymous sync is unavailable, continuing in local guest mode:', err);
      const { completeOnboarding } = useStore.getState();
      completeOnboarding('Guest');
    } finally {
      // As with Google sign-in, avoid an infinite loading state if Firebase
      // authenticates but the application fails to transition to the dashboard.
      setGuestLoading(false);
    }
  };

  return (
    <div
      className="flex min-h-dvh w-full flex-col overflow-x-hidden bg-[#eef1f8] text-slate-900 lg:min-h-dvh lg:flex-row dark:bg-[#0b1322] dark:text-slate-100 phone-landscape:h-dvh phone-landscape:flex-row phone-landscape:overflow-hidden"
      style={{
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* ── Left — brand / product panel ── */}
      <section className="relative hidden w-full shrink-0 flex-col overflow-hidden bg-[#f4f6fc] dark:bg-[#070d20] lg:flex lg:w-1/2 phone-landscape:flex phone-landscape:w-[44%]">
        {/* Ambient background layers (decorative) */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute -top-40 right-[-10%] h-[480px] w-[480px] rounded-full bg-purple-500/10 blur-3xl dark:bg-purple-600/15" />
          <div className="absolute bottom-[-20%] left-[-10%] h-[420px] w-[420px] rounded-full bg-blue-500/10 blur-3xl dark:bg-blue-600/15" />
          {/* Planet arc, top right */}
          <div className="absolute -top-28 -right-24 h-80 w-80 rounded-full border border-slate-900/10 bg-gradient-to-br from-slate-900/5 to-transparent dark:border-white/10 dark:from-white/5 dark:to-transparent" />
          {/* Decorative wave near the bottom */}
          <svg className="absolute bottom-0 left-0 w-full opacity-60 dark:opacity-50" viewBox="0 0 900 160" fill="none" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 120 C 150 60 300 160 450 110 S 750 40 900 100" stroke="url(#ntk-login-wave)" strokeWidth="1.5" />
            <path d="M0 140 C 160 80 320 175 480 125 S 770 60 900 118" stroke="url(#ntk-login-wave)" strokeWidth="1" opacity="0.6" />
            <defs>
              <linearGradient id="ntk-login-wave" x1="0" y1="0" x2="900" y2="0" gradientUnits="userSpaceOnUse">
                <stop stopColor="#a855f7" stopOpacity="0.5" />
                <stop offset="0.5" stopColor="#6366f1" stopOpacity="0.4" />
                <stop offset="1" stopColor="#22d3ee" stopOpacity="0.5" />
              </linearGradient>
            </defs>
          </svg>
        </div>

        {/* Brand */}
        <div className="relative flex items-center px-10 pt-10 xl:px-14 xl:pt-12 phone-landscape:px-6 phone-landscape:pt-5">
          <BrandLockup />
        </div>

        {/* Hero (hidden on landscape phones — brand + illustration only) */}
        <div className="relative z-10 flex max-w-[640px] flex-1 flex-col justify-center px-10 pb-16 xl:px-14 phone-landscape:hidden">
          <h1 className="text-[2.5rem] font-extrabold leading-[1.08] tracking-tight text-slate-900 xl:text-[3.4rem] dark:text-white">
            Capture ideas.
            <br />
            Stay organized.
            <br />
            <span className="bg-gradient-to-r from-purple-500 via-indigo-400 to-cyan-400 bg-clip-text text-transparent dark:from-purple-400 dark:via-indigo-300 dark:to-cyan-300">
              Think clearly.
            </span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-slate-600 xl:text-lg dark:text-slate-400">
            Securely sync your notes across all your devices so you can stay productive anywhere, anytime.
          </p>

          <ul className="mt-10 max-w-[300px] space-y-6 xl:max-w-sm">
            {features.map(feature => (
              <li key={feature.title} className="flex items-start gap-4">
                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1 ${feature.container}`}>
                  <feature.icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{feature.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{feature.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Floating note-card illustration — wide desktop / laptop */}
        <div aria-hidden="true" className="pointer-events-none absolute bottom-20 right-0 hidden w-[36%] opacity-90 lg:block xl:w-[48%]">
          <LoginIllustration />
        </div>

        {/* Compact illustration — landscape phones */}
        <div aria-hidden="true" className="hidden flex-1 items-center justify-center p-4 phone-landscape:flex">
          <div className="w-full max-w-[220px] opacity-90">
            <LoginIllustration />
          </div>
        </div>
      </section>

      {/* ── Right — authentication panel ── */}
      <section className="relative flex flex-1 flex-col items-center overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-8 phone-landscape:py-3">
        <ThemeSwitch className="absolute right-5 top-5 z-20 hidden sm:right-8 sm:top-6 lg:flex phone-landscape:flex" />

        {/* Compact brand header — portrait phones & tablets */}
        <div className="mb-4 flex w-full max-w-md items-center justify-between lg:hidden phone-landscape:hidden">
          <BrandLockup compact />
          <ThemeSwitch />
        </div>

        <div className="w-full max-w-md m-auto">
          {/* Compact illustration — portrait phones & tablets */}
          <div aria-hidden="true" className="mb-4 flex justify-center lg:hidden phone-landscape:hidden">
            <div className="w-36 opacity-90 sm:w-52 md:mb-2 md:w-72">
              <LoginIllustration />
            </div>
          </div>

          {/* Auth card */}
          <main className="rounded-3xl border border-slate-900/10 bg-white/75 px-6 py-7 shadow-[0_24px_70px_rgba(2,8,26,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#101c33]/75 dark:shadow-[0_30px_80px_rgba(1,6,20,0.55)] sm:px-9 sm:py-9 phone-landscape:px-5 phone-landscape:py-4">
            <div className="flex flex-col items-center text-center">
              <BrandMark className="h-14 w-14 rounded-2xl phone-landscape:h-10 phone-landscape:w-10 sm:h-16 sm:w-16" />
              <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900 phone-landscape:mt-2 phone-landscape:text-lg sm:text-3xl dark:text-white">
                Welcome to NTK Note
              </h1>
              <p className="mt-2 text-sm text-slate-500 phone-landscape:mt-1 phone-landscape:text-xs sm:text-base dark:text-slate-400">
                Sign in to sync your notes
              </p>
            </div>

            {error && (
              <p role="alert" className="mt-5 rounded-xl border border-red-500/25 bg-red-500/10 px-3.5 py-2.5 text-sm font-medium text-red-600 dark:text-red-300 phone-landscape:mt-3 phone-landscape:py-2 phone-landscape:text-xs">
                {error}
              </p>
            )}

            <div className="mt-6 space-y-4 phone-landscape:mt-3 phone-landscape:space-y-2.5">
              <button
                type="button"
                onClick={handleSignIn}
                disabled={authBusy}
                aria-label="Sign in with Google"
                className="flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl bg-white text-[15px] font-bold text-slate-800 shadow-lg shadow-slate-900/10 ring-1 ring-slate-900/10 transition-all duration-200 hover:bg-slate-50 hover:shadow-xl active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent dark:focus-visible:ring-offset-[#101c33] phone-landscape:h-11 phone-landscape:text-sm"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-500" aria-hidden="true" />
                ) : (
                  <>
                    <GoogleIcon />
                    Sign in with Google
                  </>
                )}
              </button>

              <div className="flex items-center gap-3" aria-hidden="true">
                <span className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
                <span className="text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">or</span>
                <span className="h-px flex-1 bg-slate-900/10 dark:bg-white/10" />
              </div>

              <button
                type="button"
                onClick={handleGuestSignIn}
                disabled={authBusy}
                aria-label="Continue as Guest"
                className="flex h-[52px] w-full items-center justify-center gap-3 rounded-2xl border border-slate-900/10 bg-slate-900/5 text-[15px] font-bold text-slate-800 transition-all duration-200 hover:bg-slate-900/10 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent dark:border-white/10 dark:bg-white/5 dark:text-white dark:hover:bg-white/10 dark:focus-visible:ring-offset-[#101c33] phone-landscape:h-11 phone-landscape:text-sm"
              >
                {guestLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin text-slate-500 dark:text-slate-300" aria-hidden="true" />
                ) : (
                  <>
                    <LogIn className="h-5 w-5" aria-hidden="true" />
                    Continue as Guest
                  </>
                )}
              </button>

              <p aria-live="polite" className="sr-only">
                {loading ? 'Signing in with Google…' : guestLoading ? 'Signing in as guest…' : ''}
              </p>
            </div>
          </main>

          <button
            type="button"
            onClick={onBackToOverview}
            className="mx-auto mt-5 flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400/70 dark:text-slate-400 dark:hover:text-white phone-landscape:mt-2 phone-landscape:py-1 phone-landscape:text-xs"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to overview
          </button>

          <div className="mt-5 flex items-center justify-center gap-6 text-xs font-medium text-slate-400 phone-landscape:mt-2 dark:text-slate-500">
            {trustIndicators.map(item => (
              <span key={item.label} className="flex items-center gap-1.5">
                <item.icon className="h-3.5 w-3.5" aria-hidden="true" />
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
