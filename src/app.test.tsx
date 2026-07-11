// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// This suite is the FLAGS-OFF regression gate (CONTRACT §7): it must keep passing
// against the shipped v1 game even though production defaults are now all-ON.
vi.mock('./game/features', () => ({
  FEATURES: { dataV2: false, engineV2: false, draftV2: false, simV2: false },
}));

import App from './App';

afterEach(cleanup);

/** Click through the entire 11-pick draft, always taking the first option. */
function draftFullXi() {
  for (let i = 0; i < 11; i++) {
    fireEvent.click(screen.getByText(/SPIN/));
    const options = screen.getAllByTitle(/Pick value/);
    expect(options.length).toBeGreaterThan(0);
    fireEvent.click(options[0]);
  }
}

describe('Last11 UI: draft flow', () => {
  it('walks home -> lobby -> full 11-pick draft -> locked XI -> arena', () => {
    render(<App animate={false} />);

    // Home
    expect(screen.getByText(/Last/)).toBeTruthy();
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));

    // Draft: pick 1/11 visible
    expect(screen.getByText(/Pick 1\/11/)).toBeTruthy();
    draftFullXi();

    // Draft complete
    expect(screen.getByText(/Your XI is locked/)).toBeTruthy();
    fireEvent.click(screen.getByText(/ENTER THE ARENA/));
    expect(screen.getByText(/PLAY ROUND 1/)).toBeTruthy();
  });

  it('plays the full battle royale to an ending and resets', () => {
    render(<App animate={false} />);
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));
    draftFullXi();
    fireEvent.click(screen.getByText(/ENTER THE ARENA/));

    // Drive the loop: play rounds, view results, skip steals, until the end screen.
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
      throw new Error('UI stuck: no actionable button found');
    }

    // End screen: either champion or eliminated with a placement
    expect(screen.getByText('PLAY AGAIN')).toBeTruthy();
    expect(screen.queryAllByText(/Last manager standing|Eliminated/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Rounds survived')).toBeTruthy();

    // Play again resets to home
    fireEvent.click(screen.getByText('PLAY AGAIN'));
    expect(screen.getByText('ENTER THE LOBBY')).toBeTruthy();
  });

  it('the steal window actually swaps a player into the XI', () => {
    render(<App animate={false} />);
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));
    draftFullXi();
    fireEvent.click(screen.getByText(/ENTER THE ARENA/));
    fireEvent.click(screen.getByText(/PLAY ROUND 1/));

    const button = screen.getByText(/CONTINUE|SEE HOW IT ENDS/);
    if (button.textContent?.includes('CONTINUE')) {
      // Survived round 1: steal window must open with loot
      fireEvent.click(button);
      expect(screen.getByText(/Steal one player/)).toBeTruthy();
      const loot = screen.getAllByText(/·/, { selector: 'p.text-xs' });
      expect(loot.length).toBeGreaterThan(0);
      // pick the first enabled loot card, then the first XI slot
      const cards = document.querySelectorAll('button:not([disabled])');
      const lootCard = Array.from(cards).find((c) =>
        c.textContent?.match(/GK|DF|MF|FW/),
      ) as HTMLElement;
      fireEvent.click(lootCard);
      expect(screen.getByText(/Where does/)).toBeTruthy();
      const slotButtons = screen.getAllByText(/^(GK|DF|MF|FW)$/, { selector: 'span' });
      fireEvent.click(slotButtons[0].closest('button')!);
      // back in the arena at the next round intro
      expect(screen.getByText(/PLAY ROUND 2/)).toBeTruthy();
    }
    // If eliminated in round 1 there is no steal window — covered by the loop test.
  });

  it('animated spin chases the wheel, then reveals the options', () => {
    vi.useFakeTimers();
    try {
      render(<App />); // animation ON
      fireEvent.click(screen.getByText('ENTER THE LOBBY'));
      fireEvent.click(screen.getByText(/SPIN/));
      // wheel is chasing, options hidden
      expect(screen.getByText(/Spinning…/)).toBeTruthy();
      expect(screen.queryAllByTitle(/Pick value/).length).toBe(0);
      act(() => {
        vi.advanceTimersByTime(10_000);
      });
      // settled: options revealed
      expect(screen.queryByText(/Spinning…/)).toBeNull();
      expect(screen.getAllByTitle(/Pick value/).length).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sidebar fills as picks land and shows live strength', () => {
    render(<App animate={false} />);
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));

    // Empty slots at the start (11 dashes)
    expect(screen.getAllByText('—').length).toBe(11);

    fireEvent.click(screen.getByText(/SPIN/));
    fireEvent.click(screen.getAllByTitle(/Pick value/)[0]);

    // One slot filled now
    expect(screen.getAllByText('—').length).toBe(10);
    expect(screen.getByText('Strength')).toBeTruthy();
  });
});
