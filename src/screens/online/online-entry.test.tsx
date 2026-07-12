// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// vitest runs through Vite, so .env.local WOULD configure a real client — mock
// the factory so these tests never touch the network and the unconfigured
// fallback is deterministic.
vi.mock('../../game/net/supa', () => ({ supa: () => null, onlineConfigured: () => false }));

import App from '../../App';

afterEach(cleanup);

describe('online mode fork (home screen)', () => {
  it('PLAY ONLINE opens the online entry; back returns to solo home', () => {
    render(<App animate={false} />);
    // solo door unchanged (existing tests depend on this exact text)
    expect(screen.getByText('ENTER THE LOBBY')).toBeTruthy();
    fireEvent.click(screen.getByText('PLAY ONLINE'));
    expect(screen.getByText(/YOUR MANAGER NAME/)).toBeTruthy();
    // name gate: READY disabled until a name is typed
    const ready = screen.getByText('READY →') as HTMLButtonElement;
    expect(ready.disabled).toBe(true);
    fireEvent.change(screen.getByPlaceholderText(/Pep Talkiola/), { target: { value: 'Lucca' } });
    expect((screen.getByText('READY →') as HTMLButtonElement).disabled).toBe(false);
    // back out to solo
    fireEvent.click(screen.getByText(/back to solo/));
    expect(screen.getByText('ENTER THE LOBBY')).toBeTruthy();
  });

  it('without Supabase env, creating a room fails gracefully (no crash)', () => {
    render(<App animate={false} />);
    fireEvent.click(screen.getByText('PLAY ONLINE'));
    fireEvent.change(screen.getByPlaceholderText(/Pep Talkiola/), { target: { value: 'Lucca' } });
    fireEvent.click(screen.getByText('READY →'));
    fireEvent.click(screen.getByText('CREATE A ROOM'));
    // vitest has no VITE_SUPABASE_* env → the gate shows the friendly error
    expect(screen.getByText(/Online is not configured/)).toBeTruthy();
  });
});
