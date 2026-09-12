import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type {
  ControllerInvite,
  ControllerRole,
  ControllerSession,
  GameSettings,
  PublicGameState,
  SafeQuestion,
  TeamId,
} from '../shared/types';
import { emitWithAck, socket } from './socket';
import { TeamSpinner } from './Spinner';
import { parseQuestionCountDraft } from './settings';
import { ColorPicker } from './ColorPicker';

const DEFAULT_SETTINGS: GameSettings = {
  mode: 'free',
  questionCount: 10,
  timerSeconds: 30,
  teams: {
    one: { name: 'Team Aurora', color: '#8b5cf6', roster: [] },
    two: { name: 'Team Comet', color: '#14b8a6', roster: [] },
  },
};

function loadSettings(): GameSettings {
  try {
    const value = JSON.parse(localStorage.getItem('trivia-settings') ?? 'null') as GameSettings | null;
    return value ? { ...DEFAULT_SETTINGS, ...value, teams: { ...DEFAULT_SETTINGS.teams, ...value.teams } } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function generateId(): string {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  if (typeof crypto?.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadDeviceId(): string {
  const key = 'trivia-device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const created = generateId();
  localStorage.setItem(key, created);
  return created;
}

function controllerDetails(): { role: ControllerRole; token: string } | null {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('role') ?? params.get('team');
  const token = params.get('token');
  return (role === 'solo' || role === 'one' || role === 'two' || role === 'individual') && token ? { role, token } : null;
}

export function App() {
  const controller = controllerDetails();
  return controller ? <ControllerApp {...controller} /> : <HostApp />;
}

function useGameState() {
  const [state, setState] = useState<PublicGameState | null>(null);
  useEffect(() => {
    socket.on('state', setState);
    socket.emit('state:request');
    return () => { socket.off('state', setState); };
  }, []);
  return state;
}

function HostApp() {
  const state = useGameState();
  const [settings, setSettings] = useState(loadSettings);
  const [questionCountDraft, setQuestionCountDraft] = useState(() => String(loadSettings().questionCount));
  const [invites, setInvites] = useState<ControllerInvite[]>([]);
  const [baseUrl, setBaseUrl] = useState(window.location.origin);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [useSpinner, setUseSpinner] = useState(false);
  const [namesText, setNamesText] = useState('');
  const [spinnerTeams, setSpinnerTeams] = useState({ one: [] as string[], two: [] as string[] });
  const questionCountError = parseQuestionCountDraft(questionCountDraft) === null
    ? 'Enter a whole number from 1 to 50.'
    : '';

  useEffect(() => {
    const claim = () => emitWithAck<ControllerInvite[]>((ack) => socket.emit('host:claim', ack))
      .then((existingInvites) => existingInvites.length && setInvites(existingInvites))
      .catch(() => undefined);
    socket.on('connect', claim);
    if (socket.connected) claim();
    return () => { socket.off('connect', claim); };
  }, []);

  useEffect(() => {
    if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) return;
    fetch('/api/network')
      .then((response) => response.json())
      .then((data: { addresses?: string[] }) => {
        if (data.addresses?.[0]) setBaseUrl(`${window.location.protocol}//${data.addresses[0]}:${window.location.port}`);
      })
      .catch(() => undefined);
  }, []);

  const names = useMemo(() => namesText.split(/\n|,/).map((name) => name.trim()).filter(Boolean), [namesText]);
  const duplicates = useMemo(() => {
    const lower = names.map((name) => name.toLocaleLowerCase());
    return lower.filter((name, index) => lower.indexOf(name) !== index);
  }, [names]);

  const updateSettings = (patch: Partial<GameSettings>) => setSettings((current) => ({ ...current, ...patch }));
  const updateTeam = (teamId: TeamId, patch: Partial<GameSettings['teams'][TeamId]>) =>
    setSettings((current) => ({
      ...current,
      teams: { ...current.teams, [teamId]: { ...current.teams[teamId], ...patch } },
    }));

  const prepareGame = async (overrides = settings) => {
    setError('');
    const parsedQuestionCount = parseQuestionCountDraft(questionCountDraft);
    if (parsedQuestionCount === null) return setError('Enter a valid question count from 1 to 50.');
    if (overrides.mode === 'teams' && useSpinner) {
      if (duplicates.length) return setError('Player names must be unique.');
      if (names.length < 2) return setError('Add at least two player names for the spinner.');
      if (spinnerTeams.one.length + spinnerTeams.two.length !== names.length) return setError('Run the spinner through every player before starting.');
    }
    const finalSettings: GameSettings = {
      ...overrides,
      questionCount: parsedQuestionCount,
      teams: {
        one: { ...overrides.teams.one, roster: useSpinner ? spinnerTeams.one : [] },
        two: { ...overrides.teams.two, roster: useSpinner ? spinnerTeams.two : [] },
      },
    };
    setLoading(true);
    try {
      const response = await fetch(`/api/questions?limit=${finalSettings.questionCount}`);
      const body = await response.json() as SafeQuestion[] | { error: string };
      if (!response.ok) throw new Error('error' in body ? body.error : 'Unable to load questions.');
      const questions = body as SafeQuestion[];
      const newInvites = await emitWithAck<ControllerInvite[]>((ack) =>
        socket.emit('host:prepare', { settings: finalSettings, questionIds: questions.map((question) => question.id) }, ack));
      localStorage.setItem('trivia-settings', JSON.stringify(finalSettings));
      setSettings(finalSettings);
      setInvites(newInvites);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start the game.');
    } finally {
      setLoading(false);
    }
  };

  const action = async (run: Parameters<typeof emitWithAck>[0]) => {
    setError('');
    try { await emitWithAck(run); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'That action failed.'); }
  };

  const exitGame = async () => {
    const active = ['question', 'answering', 'steal', 'resolved', 'paused'].includes(state?.phase ?? '');
    if (active && !window.confirm('Exit this game and return to setup? Current progress will be lost.')) return;
    await action((ack) => socket.emit('host:reset', ack));
    setInvites([]);
  };

  if (!state) return <LoadingScreen label="Connecting to the game server…" />;

  return (
    <main className="app-shell">
      <header className="brand"><div className="brand-mark">?</div><span>Living Room Trivia</span></header>
      {state.phase !== 'setup' && <button className="exit-button" onClick={exitGame} aria-label="Exit game">Exit ×</button>}
      {error && <div className="error-banner" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
      {state.phase === 'setup' && (
        <SetupScreen
          settings={settings}
          questionCountDraft={questionCountDraft}
          setQuestionCountDraft={setQuestionCountDraft}
          questionCountError={questionCountError}
          updateSettings={updateSettings}
          updateTeam={updateTeam}
          loading={loading}
          onStart={() => prepareGame()}
          useSpinner={useSpinner}
          setUseSpinner={setUseSpinner}
          namesText={namesText}
          setNamesText={setNamesText}
          names={names}
          duplicates={duplicates}
          onSpinnerChange={setSpinnerTeams}
        />
      )}
      {state.phase === 'lobby' && (
        <Lobby state={state} invites={invites} baseUrl={baseUrl} setBaseUrl={setBaseUrl}
          onBegin={() => action((ack) => socket.emit('host:begin', ack))}
          onLockRoster={() => action((ack) => socket.emit('host:lockRoster', ack))}
          onUnlockRoster={() => action((ack) => socket.emit('host:unlockRoster', ack))}
          onRemovePlayer={(playerId) => action((ack) => socket.emit('host:removePlayer', { playerId }, ack))} />
      )}
      {['question', 'buzz_locked', 'answering', 'steal', 'resolved', 'paused'].includes(state.phase) && (
        <GameBoard state={state}
          onAnswer={(answerId) => action((ack) => socket.emit('host:answer', { answerId }, ack))}
          onNext={() => action((ack) => socket.emit('host:next', ack))}
          onPause={() => action((ack) => socket.emit('host:pause', ack))}
          onResume={() => action((ack) => socket.emit('host:resume', ack))} />
      )}
      {state.phase === 'complete' && (
        <FinalScreen state={state} loading={loading} onPlayAgain={() => prepareGame(settings)}
          onNewGame={() => action((ack) => socket.emit('host:reset', ack))} />
      )}
    </main>
  );
}

interface SetupProps {
  settings: GameSettings;
  questionCountDraft: string;
  setQuestionCountDraft: (value: string) => void;
  questionCountError: string;
  updateSettings: (patch: Partial<GameSettings>) => void;
  updateTeam: (teamId: TeamId, patch: Partial<GameSettings['teams'][TeamId]>) => void;
  loading: boolean;
  onStart: () => void;
  useSpinner: boolean;
  setUseSpinner: (value: boolean) => void;
  namesText: string;
  setNamesText: (value: string) => void;
  names: string[];
  duplicates: string[];
  onSpinnerChange: (teams: { one: string[]; two: string[] }) => void;
}

function SetupScreen(props: SetupProps) {
  const { settings } = props;
  const [openColor, setOpenColor] = useState<TeamId | null>(null);
  return (
    <div className="setup-layout">
      <section className="hero-copy">
        <span className="eyebrow">Tonight’s main event</span>
        <h1>Turn your living room into a game show.</h1>
        <p>Fresh questions, quick thinking, and phone-powered buzzers. No accounts. No fuss.</p>
        <div className="feature-row"><span>◆ Live buzzers</span><span>◆ 10 categories</span><span>◆ Instant setup</span></div>
      </section>
      <section className="setup-card">
        <h2>Set up your game</h2>
        <fieldset className="mode-picker">
          <legend>Game mode</legend>
          <label className={settings.mode === 'free' ? 'selected' : ''}>
            <input type="radio" name="mode" value="free" checked={settings.mode === 'free'} onChange={() => props.updateSettings({ mode: 'free' })} />
            <strong>Free Play</strong><small>Relaxed, no scoring</small>
          </label>
          <label className={settings.mode === 'teams' ? 'selected' : ''}>
            <input type="radio" name="mode" value="teams" checked={settings.mode === 'teams'} onChange={() => props.updateSettings({ mode: 'teams' })} />
            <strong>Team vs Team</strong><small>Phones become buzzers</small>
          </label>
          <label className={settings.mode === 'individuals' ? 'selected' : ''}>
            <input type="radio" name="mode" value="individuals" checked={settings.mode === 'individuals'} onChange={() => props.updateSettings({ mode: 'individuals' })} />
            <strong>Everyone for Themselves</strong><small>2–12 individual players</small>
          </label>
        </fieldset>
        <div className="form-grid">
          <label>Questions <input inputMode="numeric" value={props.questionCountDraft} onChange={(event) => props.setQuestionCountDraft(event.target.value)} onBlur={() => {
            const parsed = parseQuestionCountDraft(props.questionCountDraft);
            if (parsed !== null) props.updateSettings({ questionCount: parsed });
          }} aria-invalid={Boolean(props.questionCountError)} aria-describedby="question-count-error" />
            {props.questionCountError && <small id="question-count-error" className="field-error">{props.questionCountError}</small>}
          </label>
          <label>Seconds per question <input type="number" min="5" max="120" value={settings.timerSeconds} onChange={(event) => props.updateSettings({ timerSeconds: Math.min(120, Math.max(5, Number(event.target.value))) })} /></label>
        </div>
        {settings.mode === 'teams' && (
          <div className="team-setup">
            <div className="form-grid">
              {(['one', 'two'] as TeamId[]).map((teamId, index) => (
                <label key={teamId}>Team {index + 1} name
                  <span className="color-input"><ColorPicker color={settings.teams[teamId].color} label={`Team ${index + 1}`} open={openColor === teamId} onToggle={() => setOpenColor((value) => value === teamId ? null : teamId)} onClose={() => setOpenColor(null)} onChange={(color) => props.updateTeam(teamId, { color })} /><input value={settings.teams[teamId].name} maxLength={24} onChange={(event) => props.updateTeam(teamId, { name: event.target.value })} /></span>
                </label>
              ))}
            </div>
            <label className="toggle"><input type="checkbox" checked={props.useSpinner} onChange={(event) => props.setUseSpinner(event.target.checked)} /><span /> Randomly assign players with the spinner</label>
            {props.useSpinner && <>
              <label>Player names <textarea rows={3} value={props.namesText} onChange={(event) => props.setNamesText(event.target.value)} placeholder="One name per line or separated by commas" /></label>
              {props.duplicates.length > 0 && <small className="field-error">Remove duplicate player names.</small>}
              <TeamSpinner names={props.names} onChange={props.onSpinnerChange} />
            </>}
          </div>
        )}
        <button className="primary start-button" disabled={props.loading || Boolean(props.questionCountError)} onClick={props.onStart}>{props.loading ? 'Loading questions…' : 'Set up controllers →'}</button>
      </section>
    </div>
  );
}

function Lobby({ state, invites, baseUrl, setBaseUrl, onBegin, onLockRoster, onUnlockRoster, onRemovePlayer }: {
  state: PublicGameState; invites: ControllerInvite[]; baseUrl: string; setBaseUrl: (value: string) => void; onBegin: () => void;
  onLockRoster: () => void; onUnlockRoster: () => void; onRemovePlayer: (playerId: string) => void;
}) {
  const bothConnected = state.teams.one.connected && state.teams.two.connected;
  const roles: ControllerRole[] = state.mode === 'free' ? ['solo'] : state.mode === 'teams' ? ['one', 'two'] : ['individual'];
  const connectedPlayers = state.individualPlayers.filter((player) => player.connected).length;
  const canBegin = state.mode === 'free' || (state.mode === 'teams' && bothConnected);
  return <section className="lobby card-wide">
    <span className="eyebrow">Controller check</span><h1>Scan. Connect. Get ready.</h1>
    <p>{state.mode === 'free' ? 'Optionally scan this code to answer from your phone, or continue on the main screen.' : state.mode === 'teams' ? 'Each team can scan its code on one or more phones.' : 'Everyone scans the same code, then joins with a unique name.'}</p>
    <label className="url-field">Phone-accessible address<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value.replace(/\/$/, ''))} /></label>
    <div className={`qr-grid ${state.mode === 'free' ? 'solo' : ''}`}>
      {roles.map((role) => {
        const invite = invites.find((item) => item.role === role);
        const url = invite ? `${baseUrl}/controller?role=${role}&token=${encodeURIComponent(invite.token)}` : '';
        const team = role === 'one' || role === 'two' ? state.teams[role] : null;
        const connected = role === 'solo' ? state.soloConnected : role === 'individual' ? connectedPlayers > 0 : team!.connected;
        return <article key={role} className="qr-card" style={{ '--team': team?.color ?? '#22d3ee' } as React.CSSProperties}>
          <h2>{team?.name ?? (role === 'individual' ? 'Join the game' : 'Solo controller')}</h2>{url ? <QRCodeSVG value={url} size={190} marginSize={2} /> : <div className="qr-placeholder">Reopen the host page to recover controller links.</div>}
          <div className={`connection ${connected ? 'online' : ''}`}><span />{role === 'individual' ? `${connectedPlayers} of 12 players joined` : team ? `${team.controllerCount} phone${team.controllerCount === 1 ? '' : 's'} connected` : connected ? 'Connected' : 'Phone is optional'}</div>
          {team && team.roster.length > 0 && <p className="roster-line">{team.roster.join(' · ')}</p>}
        </article>;
      })}
    </div>
    {state.mode === 'individuals' && <div className="player-chips">{state.individualPlayers.map((player) => <span key={player.id} className={player.connected ? '' : 'offline'}>{player.name}<small>{player.ready ? '✓ Ready' : 'Not ready'}</small>{!state.rosterLocked && <button aria-label={`Remove ${player.name}`} onClick={() => onRemovePlayer(player.id)}>×</button>}</span>)}</div>}
    {state.mode === 'individuals' ? <div className="roster-controls">{state.rosterLocked ? <><p>Roster locked. The game starts when every player is connected and ready.</p><button className="ghost" onClick={onUnlockRoster}>Unlock roster</button></> : <button className="primary start-button" disabled={state.individualPlayers.length < 2} onClick={onLockRoster}>{state.individualPlayers.length < 2 ? 'Waiting for at least 2 players…' : `Lock roster with ${state.individualPlayers.length} players →`}</button>}</div>
      : <button className="primary start-button" disabled={!canBegin} onClick={onBegin}>{state.mode === 'free' ? state.soloConnected ? 'Start with phone →' : 'Play on this screen →' : bothConnected ? 'Start the game →' : 'Waiting for both teams…'}</button>}
  </section>;
}

function ScoreCorners({ state }: { state: PublicGameState }) {
  if (state.mode !== 'teams') return null;
  return <div className="score-row">
    {(['one', 'two'] as TeamId[]).map((teamId) => <div key={teamId} className={`score-card ${state.answeringTeam === teamId ? 'active' : ''}`} style={{ '--team': state.teams[teamId].color } as React.CSSProperties}>
      <span className={`mini-status ${state.teams[teamId].connected ? 'online' : ''}`} />
      <strong>{state.teams[teamId].name}</strong><b>{state.teams[teamId].score}</b>
    </div>)}
  </div>;
}

function GameBoard({ state, onAnswer, onNext, onPause, onResume }: {
  state: PublicGameState; onAnswer: (id: string) => void; onNext: () => void; onPause: () => void; onResume: () => void;
}) {
  const question = state.question;
  if (!question) return <LoadingScreen label="Preparing the next question…" />;
  const seconds = Math.ceil(state.remainingMs / 1000);
  const progress = Math.max(0, state.remainingMs / (state.timerSeconds * 1000));
  const correctText = question.answers.find((answer) => answer.id === state.result?.correctAnswerId)?.text;
  const advanceSeconds = Math.ceil(state.resolutionRemainingMs / 1000);
  return <section className="game-stage">
    <ScoreCorners state={state} />
    <div className="game-meta"><span>Question {state.questionIndex + 1} <i>/ {state.questionCount}</i></span><span>{question.category.replaceAll('_', ' ')}</span><span className={`difficulty ${question.difficulty}`}>{question.difficulty}</span></div>
    {state.phase !== 'resolved' && <div className={`timer ${seconds <= 5 ? 'urgent' : ''}`} style={{ '--progress': progress } as React.CSSProperties}><b>{seconds}</b><small>sec</small></div>}
    <article className="question-card">
      <h1>{question.question}</h1>
      <div className={`answer-grid ${state.mode !== 'free' ? 'display-only' : ''}`}>
        {question.answers.map((answer, index) => {
          const isCorrect = state.phase === 'resolved' && answer.id === state.result?.correctAnswerId;
          const isWrong = state.wrongAnswerIds.includes(answer.id);
          return <button key={answer.id} className={isCorrect ? 'answer-correct' : isWrong ? 'answer-wrong' : ''}
            disabled={state.mode !== 'free' || state.phase !== 'question'}
            onClick={() => onAnswer(answer.id)}><kbd>{String.fromCharCode(65 + index)}</kbd>{answer.text}{isCorrect && <span className="answer-mark">✓</span>}{isWrong && <span className="answer-mark">×</span>}</button>;
        })}
      </div>
      {state.mode === 'teams' && ['question', 'buzz_locked', 'answering', 'steal'].includes(state.phase) && <div className="tv-status">
        {state.phase === 'question' ? <><span className="pulse-dot" /> Buzzers are open</> : <><span style={{ color: state.teams[state.answeringTeam!].color }}>●</span> {state.teams[state.answeringTeam!].name} {state.phase === 'buzz_locked' ? 'buzzed first!' : state.phase === 'steal' ? 'can steal' : 'is answering'}</>}
      </div>}
      {state.mode === 'individuals' && ['question', 'buzz_locked', 'answering'].includes(state.phase) && <div className="tv-status">
        {state.phase === 'question' ? <><span className="pulse-dot" /> Buzzers are open</> : <><span className="pulse-dot" /> {state.individualPlayers.find((player) => player.id === state.buzzedPlayerId)?.name ?? 'A player'} {state.phase === 'buzz_locked' ? 'buzzed first!' : 'is answering'}</>}
      </div>}
      {state.phase === 'buzz_locked' && <div className="buzz-lock-banner">Answers unlock in {(state.buzzDelayRemainingMs / 1000).toFixed(1)}s</div>}
      {['teams', 'individuals'].includes(state.mode) && state.phase === 'question' && <div className="skip-progress">Skip votes: {state.skipVoteCount} / {state.skipVoteTotal}</div>}
      {state.phase === 'resolved' && <div className={`reveal ${state.result?.reason === 'correct' ? 'correct' : 'missed'}`}>
        <span>{state.result?.reason === 'correct' ? 'Correct!' : state.result?.reason === 'timeout' ? 'Time’s up' : state.result?.reason === 'skipped' ? 'Question skipped' : 'Not quite'}</span>
        <strong>{correctText}</strong><small>Next {state.questionIndex + 1 === state.questionCount ? 'results' : 'question'} in {advanceSeconds}…</small>
      </div>}
    </article>
    <div className="host-controls">
      {state.phase === 'resolved' && <button className="primary" onClick={onNext}>{state.questionIndex + 1 === state.questionCount ? 'Results now →' : 'Next now →'}</button>}
      {['question', 'buzz_locked', 'steal'].includes(state.phase) && <button className="ghost" onClick={onPause}>Pause</button>}
      {state.phase === 'paused' && <div className="pause-overlay"><h2>Game paused</h2><p>{state.pausedMessage}</p><button className="primary" onClick={onResume}>Resume game</button></div>}
    </div>
  </section>;
}

function FinalScreen({ state, loading, onPlayAgain, onNewGame }: { state: PublicGameState; loading: boolean; onPlayAgain: () => void; onNewGame: () => void }) {
  const winner = state.teams.one.score === state.teams.two.score ? null : state.teams.one.score > state.teams.two.score ? state.teams.one : state.teams.two;
  return <section className="final-screen card-wide"><span className="confetti">✦ · ✦ · ✦</span><span className="eyebrow">That’s the game</span>
    <h1>{state.mode === 'free' ? 'Nicely played!' : state.mode === 'individuals' ? 'Final leaderboard' : winner ? `${winner.name} wins!` : 'It’s a tie!'}</h1>
    {state.mode === 'teams' && <div className="final-scores"><div>{state.teams.one.name}<b>{state.teams.one.score}</b></div><span>—</span><div>{state.teams.two.name}<b>{state.teams.two.score}</b></div></div>}
    {state.mode === 'individuals' && <Leaderboard entries={state.leaderboard ?? []} />}
    <p>You made it through {state.questionCount} questions.</p>
    <div className="button-row"><button className="primary" disabled={loading} onClick={onPlayAgain}>{loading ? 'Loading…' : 'Play again'}</button><button className="ghost" onClick={onNewGame}>New game</button></div>
  </section>;
}

function Leaderboard({ entries }: { entries: NonNullable<PublicGameState['leaderboard']> }) {
  return <div className="leaderboard">{entries.map((entry) => <div key={entry.playerId} className={entry.rank === 1 ? 'winner' : ''}><b>#{entry.rank}</b><strong>{entry.name}</strong><span>{entry.score} pts</span><small>{entry.correctAnswers} correct{entry.averageResponseMs === null ? '' : ` · ${(entry.averageResponseMs / 1000).toFixed(1)}s avg`}</small></div>)}</div>;
}

function ControllerApp({ role, token }: { role: ControllerRole; token: string }) {
  const state = useGameState();
  const [session, setSession] = useState<ControllerSession | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [joining, setJoining] = useState(false);
  const [hasSkipVote, setHasSkipVote] = useState(false);
  const [error, setError] = useState('');
  const [deviceId] = useState(loadDeviceId);
  const storageKey = `trivia-controller:${role}:${token}`;

  useEffect(() => {
    const join = () => {
      const reconnectToken = localStorage.getItem(storageKey) ?? undefined;
      if (role === 'individual' && !reconnectToken) return;
      setJoining(true);
      emitWithAck<ControllerSession>((ack) => socket.emit('controller:join', { role, token, deviceId, reconnectToken }, ack))
        .then((joinedSession) => { localStorage.setItem(storageKey, joinedSession.reconnectToken); setSession(joinedSession); setError(''); })
        .catch((caught) => { if (reconnectToken) localStorage.removeItem(storageKey); setError(caught instanceof Error ? caught.message : 'Unable to join.'); })
        .finally(() => setJoining(false));
    };
    socket.on('connect', join);
    if (socket.connected) join();
    return () => { socket.off('connect', join); };
  }, [role, token, storageKey, deviceId]);

  useEffect(() => { setHasSkipVote(false); }, [state?.question?.id]);

  const registerIndividual = async () => {
    setJoining(true); setError('');
    try {
      const joinedSession = await emitWithAck<ControllerSession>((ack) => socket.emit('controller:join', { role, token, deviceId, name: nameDraft }, ack));
      localStorage.setItem(storageKey, joinedSession.reconnectToken); setSession(joinedSession);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to join.'); }
    finally { setJoining(false); }
  };

  const action = async (run: Parameters<typeof emitWithAck>[0]) => {
    try { await emitWithAck(run); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Action failed.'); }
  };

  if (!state) return <LoadingScreen label="Connecting to the game…" />;
  if (role === 'individual' && !session) return <main className="controller-shell individual-join"><header><div className="brand-mark">?</div><div><small>Everyone for Themselves</small><strong>Join the game</strong></div></header><section className="join-form"><span className="eyebrow">Choose your player name</span><h1>What should we call you?</h1><p>Names must be unique. Your score stays secret until the final leaderboard.</p><label>Display name<input autoFocus value={nameDraft} maxLength={24} onChange={(event) => setNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') registerIndividual(); }} /></label>{error && <div className="join-error">{error}</div>}<button className="primary" disabled={joining || !nameDraft.trim()} onClick={registerIndividual}>{joining ? 'Joining…' : 'Join game →'}</button></section></main>;
  if (!session) return <LoadingScreen label={error || joining ? error || 'Joining your controller…' : 'Joining your controller…'} />;
  const isSolo = role === 'solo';
  const isTeam = role === 'one' || role === 'two';
  const isIndividual = role === 'individual';
  const team = isTeam ? state.teams[role] : null;
  const other = isTeam ? state.teams[role === 'one' ? 'two' : 'one'] : null;
  const question = state.question;
  const feedback = isIndividual && session.playerId ? state.individualFeedback[session.playerId] : state.controllerFeedback[role];
  const canBuzz = (isTeam || isIndividual) && state.phase === 'question';
  const canAnswer = Boolean(question && (isSolo ? state.mode === 'free' && state.phase === 'question' : isTeam ? ['answering', 'steal'].includes(state.phase) && state.answeringTeam === role : state.phase === 'answering' && state.answeringPlayerId === session.playerId));
  const connected = isSolo ? state.soloConnected : isTeam ? team!.connected : state.individualPlayers.find((player) => player.id === session.playerId)?.connected ?? false;
  const currentPlayer = isIndividual ? state.individualPlayers.find((player) => player.id === session.playerId) : null;
  const answeringName = state.individualPlayers.find((player) => player.id === state.answeringPlayerId)?.name;
  return <main className="controller-shell" style={{ '--team': team?.color ?? '#22d3ee' } as React.CSSProperties}>
    <header><div className="brand-mark">?</div><div><small>{isSolo ? 'Free Play' : isIndividual ? 'Playing as' : 'You’re playing for'}</small><strong>{team?.name ?? session.name ?? 'Solo controller'}</strong></div>{team && <b>{team.score}</b>}</header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    <section className="controller-content">
      {state.phase === 'setup' && <div className="controller-message"><span className="miss-icon">×</span><h1>Game ended</h1><p>Scan a new code from the host screen to play again.</p></div>}
      {state.phase === 'lobby' && (connected
        ? isIndividual ? <div className="controller-message ready-panel"><span className={currentPlayer?.ready ? 'success-icon' : 'lock-icon'}>{currentPlayer?.ready ? '✓' : '●'}</span><h1>{currentPlayer?.ready ? 'You’re ready!' : 'You’re in!'}</h1><p>{state.rosterLocked ? 'The roster is locked. The game starts when everyone is ready.' : 'The host will lock the roster when everyone has joined.'}</p><button className={currentPlayer?.ready ? 'ghost ready-button' : 'primary ready-button'} onClick={async () => { try { await emitWithAck<boolean>((ack) => socket.emit('controller:setReady', { ready: !currentPlayer?.ready }, ack)); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update readiness.'); } }}>{currentPlayer?.ready ? 'Not ready' : 'Ready!'}</button></div>
          : <div className="controller-message"><span className="success-icon">✓</span><h1>You’re connected!</h1><p>Keep this screen open. The host will start soon.</p></div>
        : <div className="controller-message"><span className="miss-icon">×</span><h1>New game ready</h1><p>Scan the new code on the host screen to reconnect.</p></div>)}
      {question && <>
        <div className="phone-meta">Question {state.questionIndex + 1} of {state.questionCount}<span>{Math.ceil(state.remainingMs / 1000)}s</span></div>
        <h2 className="phone-question">{question.question}</h2>
      </>}
      {canBuzz && question && <div className="buzzer-zone"><button className="buzzer" onClick={() => action((ack) => socket.emit('controller:buzz', { questionId: question.id }, ack))}><span>BUZZ!</span><small>Tap first to answer</small></button><button className={`skip-vote ${hasSkipVote ? 'voted' : ''}`} onClick={async () => { try { const voted = await emitWithAck<boolean>((ack) => socket.emit('controller:skipVote', { questionId: question.id }, ack)); setHasSkipVote(voted); setError(''); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Vote failed.'); } }}>{hasSkipVote ? '✓ Voted to skip' : 'Vote to skip'} <small>{state.skipVoteCount}/{state.skipVoteTotal}</small></button></div>}
      {state.phase === 'buzz_locked' && question && <div className="controller-message"><span className="lock-icon">●</span><h1>{isTeam && state.buzzedTeam === role ? `${team?.name} buzzed first!` : isIndividual && state.buzzedPlayerId === session.playerId ? 'You buzzed first!' : `${answeringName ?? state.teams[state.buzzedTeam ?? 'one'].name} buzzed first`}</h1><p>Answers unlock in {(state.buzzDelayRemainingMs / 1000).toFixed(1)} seconds.</p></div>}
      {canAnswer && question && <div className="phone-answers"><p>{state.phase === 'steal' ? 'Steal the point!' : 'Choose your answer'}</p>{question.answers.map((answer, index) => <button key={answer.id} disabled={state.wrongAnswerIds.includes(answer.id)} onClick={() => action((ack) => socket.emit('controller:answer', { questionId: question.id, answerId: answer.id }, ack))}><kbd>{String.fromCharCode(65 + index)}</kbd>{answer.text}</button>)}</div>}
      {feedback === 'incorrect' && state.phase === 'steal' && !canAnswer && <Feedback status="incorrect" score={team?.score} detail={`${other?.name ?? 'The other team'} can steal.`} />}
      {question && !canBuzz && !canAnswer && !feedback && ['answering', 'steal'].includes(state.phase) && <div className="controller-message"><span className="lock-icon">●</span><h1>{isIndividual ? `${answeringName ?? 'Another player'} is answering` : other?.id === state.answeringTeam ? `${other.name} is answering` : 'Answer locked in'}</h1><p>Watch the big screen for the result.</p></div>}
      {state.phase === 'resolved' && question && (feedback ? <Feedback status={feedback} score={team?.score} detail={`Next in ${Math.ceil(state.resolutionRemainingMs / 1000)}…`} /> : <div className="controller-message"><span className="lock-icon">●</span><h1>Question complete</h1><p>Next in {Math.ceil(state.resolutionRemainingMs / 1000)}…</p></div>)}
      {state.phase === 'paused' && <div className="controller-message"><h1>Game paused</h1><p>{state.pausedMessage}</p></div>}
      {state.phase === 'complete' && (isIndividual ? <div className="phone-leaderboard"><span className="success-icon">★</span><h1>Final leaderboard</h1><Leaderboard entries={state.leaderboard ?? []} /></div> : <div className="controller-message"><span className="success-icon">★</span><h1>{team ? `Final score: ${team.score}` : 'Great game!'}</h1><p>{team && other ? team.score > other.score ? 'Your team wins!' : team.score === other.score ? 'It’s a tie!' : 'Great game!' : 'Watch the host screen to play again.'}</p></div>)}
    </section>
    <footer><span className={`connection ${connected ? 'online' : ''}`}><span />{connected ? 'Connected' : 'Reconnecting'}</span></footer>
  </main>;
}

function Feedback({ status, score, detail }: { status: 'correct' | 'incorrect'; score?: number; detail: string }) {
  return <div className={`controller-message feedback-${status}`}><span className={status === 'correct' ? 'success-icon' : 'miss-icon'}>{status === 'correct' ? '✓' : '×'}</span><h1>{status === 'correct' ? 'Correct!' : 'Incorrect'}</h1>{score !== undefined && <strong className="feedback-score">Score: {score}</strong>}<p>{detail}</p></div>;
}

function LoadingScreen({ label }: { label: string }) {
  return <main className="loading-screen"><div className="brand-mark">?</div><div className="loader" /><p>{label}</p></main>;
}
