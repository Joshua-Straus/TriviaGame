import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ControllerRole, GameSettings, StoredQuestion } from '../shared/types.js';
import { GameEngine } from './game.js';

const q = (id = 'a'): StoredQuestion => ({ id, category: 'general_knowledge', difficulty: 'easy', question: `Question ${id}?`, answers: [{ id: `${id}:correct`, text: 'Correct' }, { id: `${id}:wrong`, text: 'Wrong' }], correctAnswerId: `${id}:correct` });
const settings = (mode: GameSettings['mode'], count = 1): GameSettings => ({ mode, questionCount: count, timerSeconds: 30, teams: { one: { name: 'North', color: '#8b5cf6', roster: [] }, two: { name: 'South', color: '#14b8a6', roster: [] } } });

describe('GameEngine multiplayer stability', () => {
  const engines: GameEngine[] = [];
  const invitesByEngine = new WeakMap<GameEngine, ReturnType<GameEngine['prepare']>>();
  afterEach(() => { engines.forEach((engine) => engine.reset()); engines.length = 0; vi.useRealTimers(); });
  const make = () => { const engine = new GameEngine(() => undefined); engines.push(engine); return engine; };
  const invite = (engine: GameEngine, role: ControllerRole) => invitesByEngine.get(engine)!.find((item) => item.role === role)!;
  const join = (engine: GameEngine, role: ControllerRole, socket: string, deviceId = `device-${socket}`, name?: string) => engine.joinController({ role, token: invite(engine, role).token, deviceId, name }, socket);
  const prepare = (mode: GameSettings['mode'], count = 1) => { const engine = make(); const invites = engine.prepare(settings(mode, count), Array.from({ length: count }, (_, index) => q(String.fromCharCode(97 + index))), 'host-socket'); invitesByEngine.set(engine, invites); return engine; };
  const unlockAnswers = () => vi.advanceTimersByTime(1_600);

  it('registers duplicate joins idempotently by invite and deviceId', () => {
    const engine = prepare('teams'); const first = join(engine, 'one', 'socket-a', 'same-device'); const second = join(engine, 'one', 'socket-b', 'same-device');
    expect(second.controllerId).toBe(first.controllerId); expect(engine.snapshot().teams.one.controllerCount).toBe(1);
  });

  it('counts four physical team phones and never counts the host', () => {
    const engine = prepare('teams'); join(engine, 'one', 'one-a'); join(engine, 'one', 'one-b'); join(engine, 'two', 'two-a'); join(engine, 'two', 'two-b');
    expect(engine.snapshot().teams.one.controllerCount + engine.snapshot().teams.two.controllerCount).toBe(4);
  });

  it('keeps distinct devices using one team QR as distinct controllers', () => {
    const engine = prepare('teams'); const a = join(engine, 'one', 'one-a', 'phone-a'); const b = join(engine, 'one', 'one-b', 'phone-b');
    expect(a.controllerId).not.toBe(b.controllerId); expect(engine.snapshot().teams.one.controllerCount).toBe(2);
  });

  it('uses a 1.5 second buzz lock, rejects races and early answers, then lets any teammate answer', () => {
    vi.useFakeTimers(); const engine = prepare('teams'); join(engine, 'one', 'one-a'); join(engine, 'one', 'one-b'); join(engine, 'two', 'two-a'); engine.begin(); engine.controllerBuzz('one-a', 'a');
    expect(engine.snapshot()).toMatchObject({ phase: 'buzz_locked', buzzedTeam: 'one', buzzDelayRemainingMs: 1500 }); expect(() => engine.controllerBuzz('two-a', 'a')).toThrow(/not currently open/i); expect(() => engine.controllerAnswer('one-b', 'a', 'a:correct')).toThrow(/turn|locked|phase/i);
    unlockAnswers(); expect(engine.snapshot().phase).toBe('answering'); engine.controllerAnswer('one-b', 'a', 'a:correct'); expect(engine.snapshot().teams.one.score).toBe(1);
  });

  it('pauses if the winning team loses its final phone during lock-in and resumes on reconnect', () => {
    vi.useFakeTimers(); const engine = prepare('teams'); const one = join(engine, 'one', 'one'); join(engine, 'two', 'two'); engine.begin(); engine.controllerBuzz('one', 'a'); vi.advanceTimersByTime(500); engine.disconnect('one'); expect(engine.snapshot().phase).toBe('paused');
    engine.joinController({ role: 'one', token: invite(engine, 'one').token, deviceId: 'device-one', reconnectToken: one.reconnectToken }, 'one-new'); engine.resume(); expect(engine.snapshot().phase).toBe('buzz_locked'); vi.advanceTimersByTime(1_100); expect(engine.snapshot().phase).toBe('answering');
  });

  it('reset cancels a stale buzz-delay transition', () => {
    vi.useFakeTimers(); const engine = prepare('teams'); join(engine, 'one', 'one'); join(engine, 'two', 'two'); engine.begin(); engine.controllerBuzz('one', 'a'); engine.reset(); vi.advanceTimersByTime(2_000); expect(engine.snapshot().phase).toBe('setup');
  });

  it('runs the locked individual ready flow and starts automatically', () => {
    const engine = prepare('individuals'); join(engine, 'individual', 'alex', 'alex-device', 'Alex'); join(engine, 'individual', 'sam', 'sam-device', 'Sam'); engine.setReady('alex', true); engine.lockRoster(); expect(engine.snapshot()).toMatchObject({ phase: 'lobby', rosterLocked: true }); engine.setReady('sam', true); expect(engine.snapshot().phase).toBe('question');
  });

  it('requires 2 players, rejects names and late joins, unlocks with readiness reset, and removes players', () => {
    const engine = prepare('individuals'); join(engine, 'individual', 'alex', 'alex-device', 'Alex'); expect(() => engine.lockRoster()).toThrow(/two/i); expect(() => join(engine, 'individual', 'duplicate', 'other-device', ' alex ')).toThrow(/taken/i); join(engine, 'individual', 'sam', 'sam-device', 'Sam'); engine.setReady('alex', true); engine.lockRoster(); expect(() => join(engine, 'individual', 'late', 'late-device', 'Late')).toThrow(/locked/i);
    engine.unlockRoster(); expect(engine.snapshot().individualPlayers.every((player) => !player.ready)).toBe(true); const sam = engine.snapshot().individualPlayers.find((player) => player.name === 'Sam')!; engine.disconnect('sam'); engine.removePlayer(sam.id); expect(engine.snapshot().individualPlayers.map((player) => player.name)).toEqual(['Alex']);
  });

  it('limits individual mode to twelve registered devices', () => {
    const engine = prepare('individuals'); for (let i = 1; i <= 12; i += 1) join(engine, 'individual', `socket-${i}`, `device-${i}`, `Player ${i}`); expect(() => join(engine, 'individual', 'socket-13', 'device-13', 'Player 13')).toThrow(/12/i);
  });

  it('preserves readiness across a locked-roster reconnect', () => {
    const engine = prepare('individuals'); const alex = join(engine, 'individual', 'alex', 'alex-device', 'Alex'); join(engine, 'individual', 'sam', 'sam-device', 'Sam'); engine.setReady('alex', true); engine.lockRoster(); engine.disconnect('alex'); engine.joinController({ role: 'individual', token: invite(engine, 'individual').token, deviceId: 'alex-device', reconnectToken: alex.reconnectToken }, 'alex-new'); expect(engine.snapshot().individualPlayers.find((player) => player.name === 'Alex')).toMatchObject({ connected: true, ready: true });
  });

  it('keeps individual scores private until the final leaderboard and has no stealing', () => {
    vi.useFakeTimers(); const engine = prepare('individuals'); join(engine, 'individual', 'alex', 'alex-device', 'Alex'); join(engine, 'individual', 'sam', 'sam-device', 'Sam'); engine.setReady('alex', true); engine.setReady('sam', true); engine.lockRoster(); engine.controllerBuzz('alex', 'a'); unlockAnswers(); engine.controllerAnswer('alex', 'a', 'a:wrong'); expect(engine.snapshot().individualPlayers[0]).not.toHaveProperty('score'); expect(() => engine.controllerAnswer('sam', 'a', 'a:correct')).toThrow(/turn|resolved/i); engine.next(); expect(engine.snapshot().leaderboard?.find((player) => player.name === 'Alex')?.score).toBe(-1);
  });

  it('requires every connected controller to vote before skipping', () => {
    const engine = prepare('teams'); join(engine, 'one', 'one-a'); join(engine, 'one', 'one-b'); join(engine, 'two', 'two'); engine.begin(); engine.toggleSkipVote('one-a', 'a'); engine.toggleSkipVote('one-b', 'a'); expect(engine.snapshot()).toMatchObject({ phase: 'question', skipVoteCount: 2, skipVoteTotal: 3 }); engine.toggleSkipVote('two', 'a'); expect(engine.snapshot()).toMatchObject({ phase: 'resolved', result: { reason: 'skipped' } });
  });

  it('free play remains scoreless and auto-advances after five seconds', () => {
    vi.useFakeTimers(); const engine = prepare('free', 2); join(engine, 'solo', 'solo'); engine.begin(); engine.controllerAnswer('solo', 'a', 'a:correct'); expect(engine.snapshot().teams.one.score).toBe(0); vi.advanceTimersByTime(5_100); expect(engine.snapshot()).toMatchObject({ phase: 'question', questionIndex: 1 });
  });
});
