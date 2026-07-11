// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// draftV2 ON so the human has a real v2 slate at the round boundary (simV2 off:
// this tests the round-INTRO board mount, not playback).
vi.mock('../game/features', () => ({
  FEATURES: { dataV2: false, engineV2: false, draftV2: true, simV2: false },
}));

import App from '../App';

afterEach(cleanup);

function draftV2FullXi() {
  for (let i = 0; i < 11; i++) {
    const spin = screen.queryByText(/^SPIN/);
    if (spin) fireEvent.click(spin);
    const players = screen.queryAllByTestId('squad-player');
    fireEvent.click(players[0]);
    if (screen.queryByText(/tap a slot/)) {
      const openSlots = Array.from(document.querySelectorAll('button[data-slot-position]')).filter(
        (b) => !(b as HTMLButtonElement).disabled,
      ) as HTMLElement[];
      fireEvent.click(openSlots[0]);
    }
  }
}

function toRoundIntro() {
  render(<App animate={false} />);
  fireEvent.click(screen.getByText('ENTER THE LOBBY'));
  fireEvent.click(screen.getByText(/START DRAFT/));
  draftV2FullXi();
  fireEvent.click(screen.getByText(/ENTER THE ARENA/));
  expect(screen.getByText(/PLAY ROUND 1/)).toBeTruthy();
}

describe('between-match board mount (round boundary)', () => {
  it('round intro offers the lineup board; it opens and closes back to the intro', () => {
    toRoundIntro();
    // affordance present because the human has a complete v2 slate
    fireEvent.click(screen.getByText(/adjust lineup/i));
    // board is open
    expect(screen.getByText(/Adjust your side/)).toBeTruthy();
    // READY closes it, back at the round intro (PLAY ROUND still available)
    fireEvent.click(screen.getByText(/READY/));
    expect(screen.getByText(/PLAY ROUND 1/)).toBeTruthy();
  });

  it('the round can still be played after visiting the board', () => {
    toRoundIntro();
    fireEvent.click(screen.getByText(/adjust lineup/i));
    fireEvent.click(screen.getByText(/READY/));
    fireEvent.click(screen.getByText(/PLAY ROUND 1/));
    // instant reveal (simV2 off) → results table
    expect(screen.getByText(/table · bottom/)).toBeTruthy();
  });
});
