// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// simV2 ON, everything else OFF → v1 draft/engine (reuse the simple draft flow) + playback.
vi.mock('../game/features', () => ({
  FEATURES: { dataV2: false, engineV2: false, draftV2: false, simV2: true },
}));

import App from '../App';

afterEach(cleanup);

function draftFullXi() {
  for (let i = 0; i < 11; i++) {
    fireEvent.click(screen.getByText(/SPIN/));
    fireEvent.click(screen.getAllByTitle(/Pick value/)[0]);
  }
}
function toArena() {
  fireEvent.click(screen.getByText('ENTER THE LOBBY'));
  draftFullXi();
  fireEvent.click(screen.getByText(/ENTER THE ARENA/));
}

describe('match playback (simV2 ON)', () => {
  it('headless (animate=false): PLAY ROUND runs playback yet still lands on the results table', () => {
    render(<App animate={false} />);
    toArena();
    fireEvent.click(screen.getByText(/PLAY ROUND 1/));
    // playback finished synchronously (the headless instant path) → table + continue control
    expect(screen.getByText(/table · bottom/)).toBeTruthy();
    expect(screen.getByText(/CONTINUE|SEE HOW IT ENDS/)).toBeTruthy();
  });

  it('headless: a full battle royale completes THROUGH playback to an ending', () => {
    render(<App animate={false} />);
    toArena();
    for (let guard = 0; guard < 40; guard++) {
      if (screen.queryByText('PLAY AGAIN')) break;
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
      throw new Error('UI stuck during playback loop');
    }
    expect(screen.getByText('PLAY AGAIN')).toBeTruthy();
    expect(screen.getByText('Rounds survived')).toBeTruthy();
  });

  it('animated: PLAY ROUND opens the on-pitch playback (scoreboard shows "your match 1/3")', () => {
    vi.useFakeTimers();
    try {
      render(<App />); // animation ON
      fireEvent.click(screen.getByText('ENTER THE LOBBY'));
      for (let i = 0; i < 11; i++) {
        fireEvent.click(screen.getByText(/SPIN/));
        act(() => vi.advanceTimersByTime(10_000)); // settle the v1 spin animation
        fireEvent.click(screen.getAllByTitle(/Pick value/)[0]);
      }
      fireEvent.click(screen.getByText(/ENTER THE ARENA/));
      fireEvent.click(screen.getByText(/PLAY ROUND 1/));
      // now watching: playback screen mounted with the live scoreboard
      expect(screen.getByText(/your match 1\//)).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
