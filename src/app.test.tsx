// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
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
    render(<App />);

    // Home
    expect(screen.getByText(/Last/)).toBeTruthy();
    fireEvent.click(screen.getByText('ENTER THE LOBBY'));

    // Draft: pick 1/11 visible
    expect(screen.getByText(/Pick 1\/11/)).toBeTruthy();
    draftFullXi();

    // Draft complete
    expect(screen.getByText(/Your XI is locked/)).toBeTruthy();
    fireEvent.click(screen.getByText(/ENTER THE ARENA/));
    expect(screen.getByText(/round 1/i)).toBeTruthy();
  });

  it('sidebar fills as picks land and shows live strength', () => {
    render(<App />);
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
