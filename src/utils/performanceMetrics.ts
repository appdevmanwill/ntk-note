/**
 * NTK Note Performance & Observability Metrics
 * Zero-cost, lightweight local performance instrumentation for owner diagnostics.
 * Conforms strictly to Spark zero-cost rules: no third-party telemetry, no analytics network calls.
 */

interface PerformanceSnapshot {
  startupDurationMs: number | null;
  lastSyncDurationMs: number | null;
  lastSyncResult: string | null;
  workerRequestCount: number;
  activeListenersCount: number;
  activeTabRole: 'leader' | 'follower' | 'standalone';
  timestamp: string;
}

const startupTime = typeof window !== 'undefined' ? performance.now() : 0;
let completedStartupDurationMs: number | null = null;
let lastSyncDurationMs: number | null = null;
let lastSyncResult: string | null = null;
let workerRequestCount = 0;
let activeListenersCount = 0;

export function recordStartupComplete(): number {
  const duration = typeof window !== 'undefined' ? Math.round(performance.now() - startupTime) : 0;
  completedStartupDurationMs = duration;
  return duration;
}

export function recordManualSyncMetrics(durationMs: number, resultText: string) {
  lastSyncDurationMs = Math.round(durationMs);
  lastSyncResult = resultText;
}

export function recordWorkerRequest() {
  workerRequestCount += 1;
}

export function setActiveListenersCount(count: number) {
  activeListenersCount = count;
}

export function getPerformanceSnapshot(tabRole: 'leader' | 'follower' | 'standalone' = 'standalone'): PerformanceSnapshot {
  return {
    startupDurationMs: completedStartupDurationMs,
    lastSyncDurationMs,
    lastSyncResult,
    workerRequestCount,
    activeListenersCount,
    activeTabRole: tabRole,
    timestamp: new Date().toISOString(),
  };
}
