/**
 * NTK Note v2.8 — Multi-Tab Coordinator & Leader Election
 *
 * Uses native BroadcastChannel to coordinate background activity across multiple tabs:
 * 1. Single active queue drainer (leader election with heartbeat and failover).
 * 2. Auth session synchronization (signs out all tabs when one tab logs out).
 * 3. PWA update coordination.
 * 4. Safe fallback if BroadcastChannel is not supported.
 */

export type TabMessageType =
  | 'HEARTBEAT'
  | 'LEADER_CLAIM'
  | 'LEADER_RESIGN'
  | 'AUTH_CHANGED'
  | 'auth_signout'
  | 'SYNC_REQUESTED'
  | 'SYNC_COMPLETED'
  | 'SW_UPDATE_AVAILABLE';

export interface TabMessage {
  type: TabMessageType;
  senderId: string;
  timestamp: number;
  payload?: Record<string, unknown>;
}

export const CHANNEL_NAME = 'ntk_tab_coordinator';
export const HEARTBEAT_INTERVAL_MS = 2000;
export const LEADER_TIMEOUT_MS = 5500;
export const ELECTION_CHECK_INTERVAL_MS = 2500;

export interface TabCoordinatorTransport {
  postMessage: (msg: TabMessage) => void;
  onmessage: ((event: { data: TabMessage }) => void) | null;
  close?: () => void;
}

export class TabCoordinator {
  public readonly tabId: string;
  private channel: BroadcastChannel | TabCoordinatorTransport | null = null;
  private isLeader = false;
  private leaderId: string | null = null;
  private lastLeaderHeartbeat = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private electionTimer: ReturnType<typeof setInterval> | null = null;
  private leaderChangeListeners = new Set<(isLeader: boolean) => void>();
  private messageListeners = new Set<(msg: TabMessage) => void>();
  private closed = false;
  private leadershipClaimedAt = 0;

  constructor(customTabId?: string, transportOverride?: TabCoordinatorTransport | null) {
    this.tabId = customTabId || `tab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    this.initChannel(transportOverride);
  }

  private initChannel(transportOverride?: TabCoordinatorTransport | null) {
    if (transportOverride) {
      this.channel = transportOverride;
      this.channel.onmessage = (event: { data: TabMessage }) => {
        this.handleMessage(event.data);
      };
      this.startHeartbeat();
      return;
    }

    if (typeof window === 'undefined') {
      // In test/Node environments without transportOverride, become standalone leader by default
      this.isLeader = true;
      return;
    }

    try {
      const BC = typeof window !== 'undefined' ? window.BroadcastChannel : globalThis.BroadcastChannel;
      if (BC) {
        this.channel = new BC(CHANNEL_NAME);
        this.channel.onmessage = (event: MessageEvent<TabMessage>) => {
          this.handleMessage(event.data);
        };
      }
    } catch {
      // Graceful fallback to standalone leader if BroadcastChannel cannot be created
      this.isLeader = true;
      return;
    }

    // Register unload listener for instant leader resignation
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.resignLeadership();
      });
      window.addEventListener('pagehide', () => {
        this.resignLeadership();
      });
    }

    this.startHeartbeat();
  }

  private startHeartbeat() {
    // Send initial claim if no leader is seen quickly
    this.electionTimer = setInterval(() => {
      this.checkElection();
    }, ELECTION_CHECK_INTERVAL_MS);

    this.heartbeatTimer = setInterval(() => {
      if (this.closed) return;
      if (this.isLeader) {
        this.broadcast({
          type: 'HEARTBEAT',
          senderId: this.tabId,
          timestamp: Date.now(),
        });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private handleMessage(msg: TabMessage) {
    if (!msg || msg.senderId === this.tabId) return;

    this.messageListeners.forEach(listener => {
      try { listener(msg); } catch {}
    });

    const now = Date.now();

    if (msg.type === 'HEARTBEAT' || msg.type === 'LEADER_CLAIM') {
      if (this.isLeader && msg.senderId !== this.tabId) {
        // Resolve split-brain deterministically: lowest string ID retains leadership
        if (msg.senderId < this.tabId) {
          this.setLeaderState(false);
          this.leaderId = msg.senderId;
          this.lastLeaderHeartbeat = now;
        } else {
          // Assert leadership
          this.claimLeadership();
        }
      } else {
        this.leaderId = msg.senderId;
        this.lastLeaderHeartbeat = now;
      }
    } else if (msg.type === 'LEADER_RESIGN') {
      if (this.leaderId === msg.senderId) {
        this.leaderId = null;
        this.lastLeaderHeartbeat = 0;
        // Step up immediately
        this.claimLeadership();
      }
    }
  }

  public checkElection(): void {
    if (this.closed) return;
    const now = Date.now();
    if (!this.isLeader && (!this.leaderId || now - this.lastLeaderHeartbeat > LEADER_TIMEOUT_MS)) {
      this.claimLeadership();
    }
  }

  public claimLeadership() {
    this.setLeaderState(true);
    this.leaderId = this.tabId;
    this.lastLeaderHeartbeat = Date.now();
    this.broadcast({
      type: 'LEADER_CLAIM',
      senderId: this.tabId,
      timestamp: Date.now(),
    });
  }

  public resignLeadership() {
    if (this.isLeader) {
      this.broadcast({
        type: 'LEADER_RESIGN',
        senderId: this.tabId,
        timestamp: Date.now(),
      });
      this.setLeaderState(false);
    }
  }

  private setLeaderState(leader: boolean) {
    if (this.isLeader !== leader) {
      this.isLeader = leader;
      this.leadershipClaimedAt = leader ? Date.now() : 0;
      this.leaderChangeListeners.forEach(fn => {
        try { fn(leader); } catch {}
      });
    }
  }

  /**
   * Check whether this tab has maintained stable leadership for at least minAgeMs.
   * Used for fallback safety when Web Locks is unavailable to prevent dual-drain during election.
   */
  public isStableLeader(minAgeMs = 500): boolean {
    if (!this.isLeader) return false;
    return (Date.now() - this.leadershipClaimedAt) >= minAgeMs;
  }

  public broadcast(msg: TabMessage) {
    if (this.channel) {
      try {
        this.channel.postMessage(msg);
      } catch {}
    }
  }

  public onLeaderChange(listener: (isLeader: boolean) => void): () => void {
    this.leaderChangeListeners.add(listener);
    listener(this.isLeader);
    return () => this.leaderChangeListeners.delete(listener);
  }

  public onMessage(listener: (msg: TabMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public addMessageListener(listener: (msg: TabMessage) => void): void {
    this.messageListeners.add(listener);
  }

  public removeMessageListener(listener: (msg: TabMessage) => void): void {
    this.messageListeners.delete(listener);
  }

  public start(): void {
    if (this.closed) {
      this.closed = false;
      this.initChannel();
    }
  }

  public stop(): void {
    this.close();
  }

  public getIsLeader(): boolean {
    return this.isLeader;
  }

  public getLeaderId(): string | null {
    return this.leaderId || (this.isLeader ? this.tabId : null);
  }

  public close() {
    this.closed = true;
    this.resignLeadership();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.electionTimer) clearInterval(this.electionTimer);
    if (this.channel) {
      try {
        if (typeof this.channel.close === 'function') {
          this.channel.close();
        }
      } catch {}
      this.channel = null;
    }
    this.leaderChangeListeners.clear();
    this.messageListeners.clear();
  }
}

// Singleton coordinator instance for the tab
let activeCoordinator: TabCoordinator | null = null;

export function getTabCoordinator(): TabCoordinator {
  if (!activeCoordinator) {
    activeCoordinator = new TabCoordinator();
  }
  return activeCoordinator;
}
