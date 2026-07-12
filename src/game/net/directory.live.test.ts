/**
 * LIVE smoke of the real SupabaseLobbyDirectory against the production Supabase
 * project (vitest loads .env.local, so supa() is genuinely configured). Skipped
 * automatically when env is absent (CI safety). Deleted after verification? No —
 * kept skipped-by-default via LIVE_NET gate so the suite never hits the network.
 */
import { describe, expect, it } from 'vitest';
import { SupabaseLobbyDirectory } from './directory';
import { onlineConfigured } from './supa';

const live = !!import.meta.env.LIVE_NET && onlineConfigured();

describe.skipIf(!live)('directory — live', () => {
  it('an announced lobby is found by a fresh finder', async () => {
    const host = new SupabaseLobbyDirectory();
    const code = 'ZZT' + Math.random().toString(36).slice(2, 4).toUpperCase();
    host.announce({ code, humans: 1, version: 'live-smoke' });
    await new Promise((r) => setTimeout(r, 1200));

    const finder = new SupabaseLobbyDirectory();
    const found = await finder.find('live-smoke');
    expect(found?.code).toBe(code);

    host.withdraw();
    await new Promise((r) => setTimeout(r, 600));
    const finder2 = new SupabaseLobbyDirectory();
    const after = await finder2.find('live-smoke');
    expect(after).toBeNull();
    host.close();
    finder.close();
    finder2.close();
  }, 25_000);
});
