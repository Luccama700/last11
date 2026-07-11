// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// ALL-ON integrated walkthrough: real FEATURES, no mock. Production ships with
// every flag ON (game/features.ts, 4bf64d5); app.test.tsx (all-false, mocked)
// is the flags-OFF regression gate. This file is the missing coverage between
// them — the actual shipped default, exercised end to end, including the
// simV2 playback screen's headless (`animate=false`) synchronous path through
// ENTER_PLAYBACK -> results, which nothing else currently drives.
import App from './App';

afterEach(cleanup);

/** Same pattern as app.v2.test.tsx's draftV2FullXi: spin, take the first squad
 *  player, and if place-mode arms (more than one open compatible slot), drop
 *  him on the first open pitch slot. */
function draftFullXi() {
  for (let i = 0; i < 11; i++) {
    const spin = screen.queryByText(/^SPIN/);
    if (spin) fireEvent.click(spin);
    const players = screen.queryAllByTestId('squad-player');
    expect(players.length).toBeGreaterThan(0);
    fireEvent.click(players[0]);
    if (screen.queryByText(/tap a slot/)) {
      const openSlots = Array.from(
        document.querySelectorAll('button[data-slot-position]'),
      ).filter((b) => !(b as HTMLButtonElement).disabled) as HTMLElement[];
      expect(openSlots.length).toBeGreaterThan(0);
      fireEvent.click(openSlots[0]);
    }
  }
}

describe('Last11 UI: ALL-ON integrated walkthrough (real FEATURES, no mock)', () => {
  it('home -> setup -> free-pick draft -> arena -> playback (headless, synchronous) -> loop to an ending -> reset', () => {
    render(<App animate={false} />);

    // Home
    expect(screen.getByText(/Last/)).toBeTruthy();
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));

    // Setup (draftV2): formation/mode/style, then start
    expect(screen.getByText(/SET UP YOUR SIDE/)).toBeTruthy();
    fireEvent.click(screen.getByText(/START DRAFT/));

    // Free-pick draft board (draftV2)
    expect(screen.getByText(/THE DRAFT/)).toBeTruthy();
    draftFullXi();
    expect(screen.getByText(/Your XI is locked/)).toBeTruthy();
    fireEvent.click(screen.getByText(/ENTER THE ARENA/));
    expect(screen.getByText(/PLAY ROUND 1/)).toBeTruthy();

    // Round 1: engineV2 resolves the round, simV2 enters playback — with
    // animate=false the match clock fires its terminal synchronously (see
    // MatchPlaybackScreen's useMatchClock), so this single click must land
    // directly on the results screen, never leaving a stuck "playback" view.
    fireEvent.click(screen.getByText(/PLAY ROUND 1/));
    expect(screen.getByText(/CONTINUE|SEE HOW IT ENDS/)).toBeTruthy();
    // No playback-only affordance (speed controls) should still be showing —
    // proof the headless path actually skipped playback, not just that SOME
    // button rendered.
    expect(screen.queryByText('1×')).toBeNull();
    expect(screen.queryByText('2×')).toBeNull();

    // Drive the rest of the loop exactly like the flags-OFF gate does: play
    // rounds / continue / see-it-end, skip steal windows, until PLAY AGAIN.
    // Every one of these clicks re-enters playback (simV2 ON) and must keep
    // resolving synchronously the same way, round after round.
    //
    // NOTE: App seeds the tournament with `Math.random()` (unseeded), so
    // whether the human ever SEES a steal window is not guaranteed by any
    // single run — an early elimination skips straight to "SEE HOW IT ENDS"
    // with no human-facing steal screen. Don't hard-require it here (that
    // would be a real flake, confirmed empirically: ~1/5 runs eliminate the
    // human round 1); the dedicated steal test below exercises that path
    // directly and only asserts inside the branch where it actually occurs.
    for (let guard = 0; guard < 40; guard++) {
      if (screen.queryByText('PLAY AGAIN')) break;
      const play = screen.queryByText(/PLAY ROUND|CONTINUE|SEE HOW IT ENDS/);
      if (play) {
        fireEvent.click(play);
        continue;
      }
      if (screen.queryByText(/Steal one player/)) {
        const skip = screen.queryByText(/SKIP — KEEP MY XI/);
        expect(skip).toBeTruthy();
        fireEvent.click(skip!);
        continue;
      }
      throw new Error('UI stuck: no actionable button found');
    }

    // End screen
    expect(screen.getByText('PLAY AGAIN')).toBeTruthy();
    expect(screen.queryAllByText(/Last manager standing|Eliminated/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Rounds survived')).toBeTruthy();

    // Play again resets to home
    fireEvent.click(screen.getByText('PLAY AGAIN'));
    expect(screen.getByText('ENTER THE LOBBY')).toBeTruthy();
  });

  it('the steal window actually swaps a player into the human XI (engineV2/simV2/draftV2 all ON)', () => {
    render(<App animate={false} />);
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));
    fireEvent.click(screen.getByText(/START DRAFT/));
    draftFullXi();
    fireEvent.click(screen.getByText(/ENTER THE ARENA/));
    fireEvent.click(screen.getByText(/PLAY ROUND 1/));

    const button = screen.getByText(/CONTINUE|SEE HOW IT ENDS/);
    if (button.textContent?.includes('CONTINUE')) {
      fireEvent.click(button);
      expect(screen.getByText(/Steal one player/)).toBeTruthy();
      // pick the first enabled loot card, then the first XI slot (detailed-position
      // era: coarse GK/DF/MF/FW labels are gone — select via testids)
      const lootCards = screen
        .getAllByTestId('loot-card')
        .filter((c) => !(c as HTMLButtonElement).disabled);
      expect(lootCards.length).toBeGreaterThan(0);
      fireEvent.click(lootCards[0]);
      expect(screen.getByText(/Where does/)).toBeTruthy();
      fireEvent.click(screen.getAllByTestId('xi-slot')[0]);
      // back in the arena at the next round intro — the round advanced, the
      // steal was applied, playback resolved synchronously again.
      expect(screen.getByText(/PLAY ROUND 2/)).toBeTruthy();
    }
    // If eliminated in round 1 there's no steal window — covered by the loop test.
  });
});
