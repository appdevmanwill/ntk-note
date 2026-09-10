import { useEffect, useState } from 'react';
import { UserRound } from 'lucide-react';
import type { UserProfile } from '@/types';
import { fetchStorageBlob } from '@/utils/cloudStorage';

const builtinAvatars = {
  aurora: ['#4f46e5', '#22d3ee'],
  sunrise: ['#f97316', '#facc15'],
  blossom: ['#ec4899', '#a855f7'],
  lagoon: ['#0f766e', '#38bdf8'],
  forest: ['#15803d', '#84cc16'],
  dusk: ['#7c3aed', '#fb7185'],
  ocean: ['#2563eb', '#06b6d4'],
  ember: ['#dc2626', '#f59e0b'],
} as const;

export type BuiltinAvatarId = keyof typeof builtinAvatars;
export const builtinAvatarIds = Object.keys(builtinAvatars) as BuiltinAvatarId[];

export function builtinAvatarValue(id: BuiltinAvatarId) {
  return `builtin:${id}`;
}

export function isBuiltinAvatar(value?: string): value is `builtin:${BuiltinAvatarId}` {
  if (!value?.startsWith('builtin:')) return false;
  const id = value.slice('builtin:'.length) as BuiltinAvatarId;
  return id in builtinAvatars;
}

// Module-level cache to prevent repeated downloads of the same custom avatar reference
const customAvatarUrlCache = new Map<string, string>();

export default function UserAvatar({
  profile,
  size = 'md',
  className = '',
}: {
  profile: Pick<UserProfile, 'name' | 'avatar'>;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}) {
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(() => {
    if (!profile.avatar || isBuiltinAvatar(profile.avatar)) return null;
    if (profile.avatar.startsWith('storage:')) {
      return customAvatarUrlCache.get(profile.avatar) || null;
    }
    return profile.avatar;
  });
  const [imgError, setImgError] = useState(false);

  useEffect(() => {
    setImgError(false);
    if (!profile.avatar || isBuiltinAvatar(profile.avatar)) {
      setResolvedSrc(null);
      return;
    }

    if (profile.avatar.startsWith('storage:')) {
      const cached = customAvatarUrlCache.get(profile.avatar);
      if (cached) {
        setResolvedSrc(cached);
        return;
      }
      let active = true;
      fetchStorageBlob(profile.avatar)
        .then((blob) => {
          if (!active) return;
          const blobUrl = URL.createObjectURL(blob);
          customAvatarUrlCache.set(profile.avatar!, blobUrl);
          setResolvedSrc(blobUrl);
        })
        .catch(() => {
          if (!active) return;
          setImgError(true);
          setResolvedSrc(null);
        });
      return () => {
        active = false;
      };
    } else {
      setResolvedSrc(profile.avatar);
    }
  }, [profile.avatar]);

  const dimensions = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-14 w-14',
    xl: 'h-16 w-16',
  }[size];

  const iconSize = {
    sm: 'h-4 w-4',
    md: 'h-5 w-5',
    lg: 'h-7 w-7',
    xl: 'h-8 w-8',
  }[size];

  if (resolvedSrc && !imgError) {
    return (
      <span className={`${dimensions} relative inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-white/65 shadow-md dark:ring-white/10 ${className}`}>
        <img
          src={resolvedSrc}
          alt={profile.name ? `${profile.name}'s profile photo` : 'Profile photo'}
          className="h-full w-full object-cover"
          referrerPolicy="no-referrer"
          onError={() => setImgError(true)}
        />
      </span>
    );
  }

  const rawId = profile.avatar?.replace('builtin:', '') as BuiltinAvatarId | undefined;
  const id: BuiltinAvatarId = rawId && rawId in builtinAvatars ? rawId : 'aurora';
  const [from, to] = builtinAvatars[id];

  return (
    <span
      className={`${dimensions} relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-2 ring-white/65 shadow-md dark:ring-white/10 ${className}`}
      style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      aria-label={profile.name ? `${profile.name}'s avatar` : 'Profile avatar'}
    >
      <span className="absolute -right-2 -top-2 h-1/2 w-1/2 rounded-full bg-white/25 blur-sm" aria-hidden="true" />
      <span className="absolute -bottom-3 -left-2 h-2/3 w-2/3 rounded-full bg-black/10 blur-md" aria-hidden="true" />
      <UserRound className={`${iconSize} relative text-white drop-shadow`} strokeWidth={2.4} aria-hidden="true" />
    </span>
  );
}
