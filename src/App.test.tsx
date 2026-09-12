// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = {
  mode: 'individuals', phase: 'lobby', question: null, questionIndex: 0, questionCount: 10,
  remainingMs: 0, buzzDelayRemainingMs: 0, resolutionRemainingMs: 0, rosterLocked: false,
  teams: { one: { id: 'one', name: 'One', color: '#000', score: 0, roster: [], connected: false, controllerCount: 0 }, two: { id: 'two', name: 'Two', color: '#000', score: 0, roster: [], connected: false, controllerCount: 0 } },
  soloConnected: false, individualPlayers: [], controllerFeedback: { solo: null, one: null, two: null, individual: null }, individualFeedback: {}, wrongAnswerIds: [], skipVoteCount: 0, skipVoteTotal: 0,
  answeringTeam: null, buzzedTeam: null, answeringPlayerId: null, buzzedPlayerId: null, pausedMessage: '', leaderboard: null,
};

vi.mock('./socket', () => {
  const socket = { connected: false, on: vi.fn((event: string, callback: (value: typeof state) => void) => { if (event === 'state') callback(state); }), off: vi.fn(), emit: vi.fn(), connect: vi.fn(), io: { on: vi.fn(), off: vi.fn() } };
  return { socket, socketTarget: 'http://192.168.1.42:3000', emitWithAck: vi.fn() };
});

import { App, controllerDetails } from './App';
import { socket } from './socket';

afterEach(() => { window.history.replaceState({}, '', '/'); });

describe('controller URL parsing', () => {
  it.each(['solo', 'one', 'two', 'individual'])('accepts the %s role', (role) => {
    expect(controllerDetails(`?role=${role}&token=invite`)).toEqual({ role, token: 'invite' });
  });

  it.each(['?role=one', '?role=invalid&token=invite', '?token=invite'])('rejects incomplete or invalid URLs', (search) => {
    expect(controllerDetails(search)).toBeNull();
  });
});

describe('individual controller route', () => {
  it('renders the name entry flow instead of host setup', () => {
    window.history.replaceState({}, '', '/controller?role=individual&token=invite');
    render(<App />);
    expect(screen.getByRole('heading', { name: 'What should we call you?' })).toBeInTheDocument();
    expect(screen.queryByText('Set up your game')).not.toBeInTheDocument();
  });

  it('shows the connection target and retries after a connection failure', () => {
    window.history.replaceState({}, '', '/controller?role=one&token=invite');
    render(<App />);
    const calls = (socket.on as unknown as { mock: { calls: [string, (error: Error) => void][] } }).mock.calls;
    calls.find(([event]) => event === 'connect_error')?.[1](new Error('Network unreachable'));
    expect(screen.getByRole('alert')).toHaveTextContent('Network unreachable');
    expect(screen.getByRole('alert')).toHaveTextContent('http://192.168.1.42:3000');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(socket.connect).toHaveBeenCalled();
  });
});
