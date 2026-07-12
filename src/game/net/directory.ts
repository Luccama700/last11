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

  /** Join the directory channel once; resolve when subscribed (null = no client). */
  private ready(): Promise<RealtimeChannel | null> {
    const client = supa();
    if (!client) return Promise.resolve(null);
    if (this.channel) return Promise.resolve(this.channel);
    const ch = client.channel(DIRECTORY_CHANNEL, {
      config: { presence: { key: `dir-${Math.random().toString(36).slice(2)}` } },
    });
    this.channel = ch;
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
    // presence state syncs right after subscribe; give a fresh join a beat
    await new Promise((r) => setTimeout(r, 600));
    const state = ch.presenceState<PublicLobby>();
    const lobbies = Object.values(state)
      .flat()
      .filter(
        (l) =>
          typeof l.code === 'string' &&
          l.version === version &&
          l.humans >= 1 &&
          l.humans < MP_LOBBY_SIZE,
      );
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
