// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Real FEATURES (all on) — exercises the actual shipped end-of-tournament seam.
import App from './App';
import { readChampions } from './game/champions';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function draftFullXi() {
  for (let i = 0; i < 11; i++) {
    const spin = screen.queryByText(/^SPIN/);
    if (spin) fireEvent.click(spin);
    const players = screen.queryAllByTestId('squad-player');
    fireEvent.click(players[0]);
    if (screen.queryByText(/tap a slot/)) {
      const openSlots = Array.from(
        document.querySelectorAll('button[data-slot-position]'),
      ).filter((b) => !(b as HTMLButtonElement).disabled) as HTMLElement[];
      fireEvent.click(openSlots[0]);
    }
  }
}

/** Play a whole tournament headlessly to the end screen. */
function playToEnd() {
  fireEvent.click(screen.getByText('ENTER THE LOBBY'));
  fireEvent.click(screen.getByText(/START DRAFT/));
  draftFullXi();
  fireEvent.click(screen.getByText(/ENTER THE ARENA/));
  for (let guard = 0; guard < 60; guard++) {
    if (screen.queryByText('PLAY AGAIN')) return;
    const play = screen.queryByText(/PLAY ROUND|CONTINUE|SEE HOW IT ENDS/);
    if (play) {
      fireEvent.click(play);
      continue;
    }
    const skip = screen.queryByText(/SKIP — KEEP MY XI/);
    if (skip) {
      fireEvent.click(skip);
      continue;
    }
    throw new Error('UI stuck before reaching the end screen');
  }
  throw new Error('never reached PLAY AGAIN');
}

describe('champions seam: a finished tournament records exactly one hall entry', () => {
  it('records one champion with a valid shape at screen -> end', () => {
    render(<App animate={false} />);
    expect(readChampions()).toEqual([]);

    playToEnd();

    const champs = readChampions();
    expect(champs).toHaveLength(1);
    const c = champs[0];
    expect(typeof c.name).toBe('string');
    expect(c.name.length).toBeGreaterThan(0);
    expect(typeof c.isHuman).toBe('boolean');
    expect(Number.isNaN(Date.parse(c.date))).toBe(false);
    // human either won (placement 1) or was eliminated (rank > 1); never unresolved.
    expect(c.placementOfHuman).not.toBeNull();
    expect(c.placementOfHuman!).toBeGreaterThanOrEqual(1);
  });

  it('a second tournament adds a second entry (once per game, not per render)', () => {
    render(<App animate={false} />);
    playToEnd();
    expect(readChampions()).toHaveLength(1);

    fireEvent.click(screen.getByText('PLAY AGAIN')); // back to home, ready for game 2
    playToEnd();
    expect(readChampions()).toHaveLength(2);
  });
});
