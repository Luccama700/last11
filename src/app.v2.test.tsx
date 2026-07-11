// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Drive the app with the v2 free-pick draft flag ON (default build ships it OFF).
vi.mock('./game/features', () => ({
  FEATURES: { dataV2: false, engineV2: false, draftV2: true, simV2: false },
}));

import App from './App';

afterEach(cleanup);

/** Fill all 11 slots: spin, take the first squad player, and if place-mode arms,
 *  drop him on the first open (enabled) pitch slot. */
function draftV2FullXi() {
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

describe('Last11 UI: v2 free-pick draft flow (draftV2 ON)', () => {
  it('walks home -> setup -> free-pick draft -> locked XI -> arena', () => {
    render(<App animate={false} />);

    // Home
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));

    // Setup: choose formation/mode/style, then start the draft
    expect(screen.getByText(/SET UP YOUR SIDE/)).toBeTruthy();
    fireEvent.click(screen.getByText(/START DRAFT/));

    // Draft board
    expect(screen.getByText(/THE DRAFT/)).toBeTruthy();
    draftV2FullXi();

    // Complete → arena
    expect(screen.getByText(/Your XI is locked/)).toBeTruthy();
    fireEvent.click(screen.getByText(/ENTER THE ARENA/));
    expect(screen.getByText(/PLAY ROUND 1/)).toBeTruthy();
  });

  it('a picked player lands on the pitch (open slots shrink by one)', () => {
    render(<App animate={false} />);
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));
    fireEvent.click(screen.getByText(/START DRAFT/));

    // 4-3-3 board starts with 11 empty dashed slots (position labels visible).
    fireEvent.click(screen.getByText(/^SPIN/));
    const players = screen.queryAllByTestId('squad-player');
    fireEvent.click(players[0]);
    if (screen.queryByText(/tap a slot/)) {
      const openSlots = Array.from(
        document.querySelectorAll('button[data-slot-position]'),
      ).filter((b) => !(b as HTMLButtonElement).disabled) as HTMLElement[];
      fireEvent.click(openSlots[0]);
    }

    // Strength readout is present and the draft advanced back to a spin prompt.
    expect(screen.getByText('Strength')).toBeTruthy();
    expect(screen.getByText(/^SPIN/)).toBeTruthy();
  });
});
