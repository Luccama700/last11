/**
 * The public-lobby directory — one shared Realtime channel (`last11:@public`)
 * where the HOST of every public lobby announces `{code, humans, version}` via
 * presence (key = room code). Quick play joins the same channel, reads the
 * presence state once, and picks the fullest joinable lobby.
 *
 * Same no-database philosophy as the rooms: a listing lives exactly as long as
 * its host tracks it — going private, starting the game, or closing the tab all
 * remove it automatically (presence leave). Nothing can go stale.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { MP_LOBBY_SIZE } from '../../engine/mp';
import { supa } from './supa';

export interface PublicLobby {
  code: string;
  humans: number;
  version: string;
}

/** Injected into the controller; tests pass a stub (or nothing — null no-ops). */
export interface LobbyDirectory {
  /** Host: create/refresh this lobby's public listing (idempotent re-track). */
  announce(lobby: PublicLobby): void;
  /** Host: pull the listing (going private / game starting / leaving). */
  withdraw(): void;
  /** Quick play: the fullest joinable public lobby on this build, or null. */
  find(version: string): Promise<PublicLobby | null>;
}

const DIRECTORY_CHANNEL = 'last11:@public'; // '@' is outside the room-code alphabet

export class SupabaseLobbyDirectory implements LobbyDirectory {
  private channel: RealtimeChannel | null = null;
  private announced: PublicLobby | null = null;
  /** Resolvers parked until the next presence-sync event lands. */
  private syncWaiters: (() => void)[] = [];
  private everSynced = false;

  /** Join the directory channel once; resolve when subscribed (null = no client).
   *  Two hard-won rules from the live project:
   *  1. The presence listener MUST be registered BEFORE subscribing — without it
   *     supabase-js never negotiates presence and presenceState() stays {}
   *     forever (the quick-play-never-finds-anything bug).
   *  2. The supabase client is a singleton, so a prior directory instance may
   *     have already joined this topic — reuse that channel; late `.on()` throws
   *     and re-`subscribe()` errors, so in that case the timeout fallbacks in
   *     nextSync() stand in for the sync events. */
  private ready(): Promise<RealtimeChannel | null> {
    const client = supa();
    if (!client) return Promise.resolve(null);
    if (this.channel) return Promise.resolve(this.channel);
    const ch =
      client.getChannels().find((c) => c.topic === `realtime:${DIRECTORY_CHANNEL}`) ??
      client.channel(DIRECTORY_CHANNEL, {
        config: { presence: { key: `dir-${Math.random().toString(36).slice(2)}` } },
      });
    this.channel = ch;
    try {
      ch.on('presence', { event: 'sync' }, () => {
        this.everSynced = true;
        for (const w of this.syncWaiters.splice(0)) w();
      });
    } catch {
      // already subscribed by a previous instance — presence is negotiated;
      // reads still work, waits fall back to timers.
    }
    if (ch.state === 'joined') return Promise.resolve(ch);
    if (ch.state === 'joining') {
      return new Promise((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          if (ch.state === 'joined') {
            clearInterval(iv);
            resolve(ch);
          } else if (Date.now() - t0 > 4_000) {
            clearInterval(iv);
            resolve(null);
          }
        }, 100);
      });
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(null), 4_000);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          resolve(ch);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timeout);
          resolve(null);
        }
      });
    });
  }

  /** Resolve on the next presence sync (or after `ms` as a fallback). */
  private nextSync(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      this.syncWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  announce(lobby: PublicLobby): void {
    this.announced = lobby;
    void this.ready().then((ch) => {
      // re-check: a withdraw() may have raced the subscribe
      if (ch && this.announced) void ch.track({ ...this.announced });
    });
  }

  withdraw(): void {
    this.announced = null;
    if (this.channel) void this.channel.untrack();
  }

  async find(version: string): Promise<PublicLobby | null> {
    const ch = await this.ready();
    if (!ch) return null;
    const read = (): PublicLobby[] =>
      Object.values(ch.presenceState<PublicLobby>())
        .flat()
        .filter(
          (l) =>
            typeof l.code === 'string' &&
            l.version === version &&
            l.humans >= 1 &&
            l.humans < MP_LOBBY_SIZE,
        );
    // Presence entries can arrive across SEVERAL sync events after a cold join
    // (live-project observation) — wait sync-by-sync up to ~3.5s, and once
    // something is visible give one extra beat for stragglers before choosing.
    const deadline = Date.now() + 3_500;
    if (!this.everSynced) await this.nextSync(1_500);
    while (read().length === 0 && Date.now() < deadline) {
      await this.nextSync(Math.max(100, Math.min(800, deadline - Date.now())));
    }
    if (read().length > 0) await this.nextSync(400);
    const lobbies = read();
    lobbies.sort((a, b) => b.humans - a.humans); // fill the fullest room first
    return lobbies[0] ?? null;
  }

  /** Tear down the directory channel entirely (leaving online altogether). */
  close(): void {
    this.announced = null;
    if (this.channel) {
      void supa()?.removeChannel(this.channel);
      this.channel = null;
    }
  }
}
