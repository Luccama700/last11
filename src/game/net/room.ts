/**
 * RoomChannel — a thin, typed wrapper over one Supabase Realtime channel per
 * room (`last11:<CODE>`). Broadcast for messages (self-receive ON so the host
 * applies its own canonical stream exactly like everyone else — one code path),
 * presence for who's here. No database.
 */
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supa } from './supa';
import { HOST_EVENT, INTENT_EVENT, type HostMsg, type Intent, type PresenceMeta } from './protocol';

export interface RoomHandlers {
  onHostMsg: (msg: HostMsg) => void;
  onIntent: (intent: Intent) => void;
  onPresence: (present: PresenceMeta[]) => void;
  onStatus: (status: 'connecting' | 'joined' | 'error' | 'closed') => void;
}

export class RoomChannel {
  private channel: RealtimeChannel | null = null;
  readonly code: string;
  readonly me: PresenceMeta;

  constructor(code: string, me: PresenceMeta, private handlers: RoomHandlers) {
    this.code = code.toUpperCase();
    this.me = me;
  }

  join(): void {
    const client = supa();
    if (!client) {
      this.handlers.onStatus('error');
      return;
    }
    this.handlers.onStatus('connecting');
    const ch = client.channel(`last11:${this.code}`, {
      config: { broadcast: { self: true }, presence: { key: this.me.clientId } },
    });
    ch.on('broadcast', { event: HOST_EVENT }, ({ payload }) => {
      this.handlers.onHostMsg(payload as HostMsg);
    });
    ch.on('broadcast', { event: INTENT_EVENT }, ({ payload }) => {
      this.handlers.onIntent(payload as Intent);
    });
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState<PresenceMeta>();
      const present = Object.values(state)
        .flat()
        .map((p) => ({ clientId: p.clientId, name: p.name, version: p.version }));
      this.handlers.onPresence(present);
    });
    ch.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await ch.track(this.me);
        this.handlers.onStatus('joined');
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        this.handlers.onStatus('error');
      } else if (status === 'CLOSED') {
        this.handlers.onStatus('closed');
      }
    });
    this.channel = ch;
  }

  sendIntent(intent: Intent): void {
    void this.channel?.send({ type: 'broadcast', event: INTENT_EVENT, payload: intent });
  }

  sendHost(msg: HostMsg): void {
    void this.channel?.send({ type: 'broadcast', event: HOST_EVENT, payload: msg });
  }

  leave(): void {
    if (this.channel) {
      void supa()?.removeChannel(this.channel);
      this.channel = null;
      this.handlers.onStatus('closed');
    }
  }
}
