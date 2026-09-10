export type SpeechProviderName = 'cloudflare' | 'google';

export interface ListenEnginePolicyConfig {
  mode?: 'automatic' | 'cloudflare' | 'google' | 'custom';
  cloudflareEnabled?: boolean;
  googleEnabled?: boolean;
  preferredOrder?: SpeechProviderName[];
}

export interface SpeechLocaleClassification {
  status: 200 | 400;
  code?: string;
  message?: string;
  closestLocale?: string;
  googleTl: string;
  cloudflareLang: string;
  isHausa: boolean;
  classification: 'NATIVE' | 'SUPPORTED' | 'CLOSEST MATCH' | 'UNAVAILABLE';
}

/**
 * Truthfully classifies requested locale and maps it to provider parameters.
 * Section 8: Playback speed is client-side only. No false provider-cadence claims.
 * Nigerian English remains CLOSEST MATCH with preservation of Nigerian names, places, and Naira formatting.
 */
export function classifySpeechLocale(
  localeOrLang = '',
  allowClosestMatch = false,
  _requestedSpeed?: number
): SpeechLocaleClassification {
  const rawLocale = localeOrLang.toLowerCase().trim();

  // Yoruba and Igbo: No native neural synthesis available on standard zero-cost engines.
  // Without user consent (allowClosestMatch), truthfully return 400 VOICE_UNAVAILABLE.
  const isYoruba = rawLocale === 'yo' || rawLocale === 'yo-ng' || rawLocale.startsWith('yo-');
  const isIgbo = rawLocale === 'ig' || rawLocale === 'ig-ng' || rawLocale.startsWith('ig-');

  if ((isYoruba || isIgbo) && !allowClosestMatch) {
    return {
      status: 400,
      code: 'VOICE_UNAVAILABLE',
      message: 'This voice is not available from your current speech services. I can use the closest available voice instead.',
      closestLocale: 'en-NG',
      googleTl: 'en',
      cloudflareLang: 'en',
      isHausa: false,
      classification: 'UNAVAILABLE',
    };
  }

  let googleTl = 'en';
  let cloudflareLang = 'en';
  let isHausa = false;
  let classification: 'NATIVE' | 'SUPPORTED' | 'CLOSEST MATCH' = 'NATIVE';

  if (rawLocale === 'ha' || rawLocale === 'ha-ng' || rawLocale.startsWith('ha-')) {
    // Native Hausa is supported natively via Google Speech Fallback
    // MeloTTS does NOT support Hausa and will be excluded
    googleTl = 'ha';
    cloudflareLang = 'en';
    isHausa = true;
    classification = 'NATIVE';
  } else if (isYoruba || isIgbo) {
    // Closest match accepted
    googleTl = 'en';
    cloudflareLang = 'en';
    classification = 'CLOSEST MATCH';
  } else if (rawLocale === 'en-ng' || rawLocale.startsWith('en-ng')) {
    // Nigerian English is a closest available match with preserved currency & names
    googleTl = 'en';
    cloudflareLang = 'en';
    classification = 'CLOSEST MATCH';
  } else if (rawLocale.startsWith('es')) {
    googleTl = 'es';
    cloudflareLang = 'es';
    classification = 'SUPPORTED';
  } else if (rawLocale.startsWith('fr')) {
    googleTl = 'fr';
    cloudflareLang = 'fr';
    classification = 'SUPPORTED';
  } else if (rawLocale.startsWith('zh')) {
    googleTl = 'zh';
    cloudflareLang = 'zh';
    classification = 'SUPPORTED';
  } else if (rawLocale.startsWith('ja')) {
    googleTl = 'ja';
    cloudflareLang = 'ja';
    classification = 'SUPPORTED';
  } else if (rawLocale.startsWith('ko')) {
    googleTl = 'ko';
    cloudflareLang = 'ko';
    classification = 'SUPPORTED';
  } else {
    // Default English (en-US, en-GB, en)
    googleTl = 'en';
    cloudflareLang = 'en';
    classification = 'NATIVE';
  }

  return {
    status: 200,
    googleTl,
    cloudflareLang,
    isHausa,
    classification,
  };
}

/**
 * Constructs the execution sequence for speech providers.
 * Enforces server-side owner policy authority (Sections 10, 11, 12, 13, 26).
 * Normal client preferredEngine can NEVER override owner mode.
 * Only owner diagnostic calls may test specific provider ordering.
 */
export function buildSpeechProviderPlan(options: {
  policyListenEngine?: ListenEnginePolicyConfig;
  hasAiBinding: boolean;
  isHausa: boolean;
  user?: { owner?: boolean };
  clientPreferredEngine?: string;
  isDiagnostic?: boolean;
}): SpeechProviderName[] {
  const engineConfig = options.policyListenEngine || {
    mode: 'automatic',
    cloudflareEnabled: true,
    googleEnabled: true,
    preferredOrder: ['cloudflare', 'google'],
  };

  const cfAllowed = engineConfig.cloudflareEnabled !== false && options.hasAiBinding;
  const googleAllowed = engineConfig.googleEnabled !== false;

  // Hausa: MeloTTS cannot synthesize Hausa phonemes; Google Speech Fallback is the only native engine
  if (options.isHausa) {
    return googleAllowed ? ['google'] : [];
  }

  // Owner Authority: Check if client is an authenticated owner running an explicit diagnostic request
  const isOwnerDiagnostic = options.user?.owner === true && options.isDiagnostic === true;
  const clientPref = options.clientPreferredEngine;

  if (isOwnerDiagnostic && (clientPref === 'cloudflare' || clientPref === 'google')) {
    const plan: SpeechProviderName[] = [];
    if (clientPref === 'cloudflare') {
      if (cfAllowed) plan.push('cloudflare');
      if (googleAllowed) plan.push('google');
    } else {
      if (googleAllowed) plan.push('google');
      if (cfAllowed) plan.push('cloudflare');
    }
    return plan;
  }

  // Normal clients & non-diagnostic owner calls: Server policy is canonical
  const mode = engineConfig.mode || 'automatic';
  const plan: SpeechProviderName[] = [];

  if (mode === 'cloudflare') {
    if (cfAllowed) plan.push('cloudflare');
    if (googleAllowed) plan.push('google'); // fallback
  } else if (mode === 'google') {
    if (googleAllowed) plan.push('google');
    if (cfAllowed) plan.push('cloudflare'); // fallback
  } else {
    // Automatic (Recommended): follow policy preferredOrder
    const preferred = engineConfig.preferredOrder || ['cloudflare', 'google'];
    for (const p of preferred) {
      if (p === 'cloudflare' && cfAllowed && !plan.includes('cloudflare')) {
        plan.push('cloudflare');
      } else if (p === 'google' && googleAllowed && !plan.includes('google')) {
        plan.push('google');
      }
    }
    // Ensure all enabled providers are available as fallbacks
    if (cfAllowed && !plan.includes('cloudflare')) {
      plan.push('cloudflare');
    }
    if (googleAllowed && !plan.includes('google')) {
      plan.push('google');
    }
  }

  return plan;
}

/**
 * Calculates remaining milliseconds until the next 00:00 UTC.
 */
export function msUntilUtcMidnight(nowDate = new Date()): number {
  const nextMidnight = new Date(
    Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate() + 1, 0, 0, 0, 0)
  );
  return Math.max(60_000, nextMidnight.getTime() - nowDate.getTime());
}

/**
 * Classifies quota/rate-limit errors to differentiate daily quota exhaustion from transient rate limits (Section 27).
 */
export function classifyQuotaCooldown(errMsg: string, status?: number): {
  isDailyQuota: boolean;
  cooldownMs: number;
  reason: string;
} {
  const isDailyExhaustion =
    /daily.*(quota|allowance)|quota.*exhaust|daily.*limit.*exceed|daily_quota_reached/i.test(errMsg);

  if (isDailyExhaustion) {
    return {
      isDailyQuota: true,
      cooldownMs: msUntilUtcMidnight(),
      reason: 'daily-quota-exhausted',
    };
  }

  const isTransientRateLimit = status === 429 || /rate.*limit|too.*many.*requests|throttle/i.test(errMsg);
  if (isTransientRateLimit) {
    return {
      isDailyQuota: false,
      cooldownMs: 60_000,
      reason: 'rate-limit',
    };
  }

  return {
    isDailyQuota: false,
    cooldownMs: 60_000,
    reason: 'provider-error',
  };
}
