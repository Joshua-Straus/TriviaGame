export type TeamId = 'one' | 'two';
export type ControllerRole = 'solo' | TeamId | 'individual';
export type AttemptFeedback = 'correct' | 'incorrect' | null;
export type GameMode = 'free' | 'teams' | 'individuals';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type GamePhase =
  | 'setup'
  | 'lobby'
  | 'question'
  | 'buzz_locked'
  | 'answering'
  | 'steal'
  | 'resolved'
  | 'paused'
  | 'complete';

export interface AnswerOption {
  id: string;
  text: string;
}

export interface SafeQuestion {
  id: string;
  category: string;
  difficulty: Difficulty;
  question: string;
  answers: AnswerOption[];
}

export interface StoredQuestion extends SafeQuestion {
  correctAnswerId: string;
}

export interface TeamState {
  id: TeamId;
  name: string;
  color: string;
  score: number;
  connected: boolean;
  controllerCount: number;
  roster: string[];
}

export interface ResolvedAnswer {
  selectedAnswerId: string | null;
  correctAnswerId: string;
  teamId: TeamId | null;
  reason: 'correct' | 'incorrect' | 'timeout' | 'skipped';
}

export interface PublicIndividualPlayer {
  id: string;
  name: string;
  connected: boolean;
  ready: boolean;
}

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  rank: number;
  score: number;
  correctAnswers: number;
  averageResponseMs: number | null;
}

export interface PublicGameState {
  phase: GamePhase;
  mode: GameMode;
  questionCount: number;
  timerSeconds: number;
  questionIndex: number;
  question: SafeQuestion | null;
  remainingMs: number;
  resolutionRemainingMs: number;
  buzzDelayRemainingMs: number;
  rosterLocked: boolean;
  soloConnected: boolean;
  teams: Record<TeamId, TeamState>;
  buzzedTeam: TeamId | null;
  answeringTeam: TeamId | null;
  buzzedPlayerId: string | null;
  answeringPlayerId: string | null;
  wrongAnswerIds: string[];
  controllerFeedback: Record<ControllerRole, AttemptFeedback>;
  individualFeedback: Record<string, AttemptFeedback>;
  individualPlayers: PublicIndividualPlayer[];
  leaderboard: LeaderboardEntry[] | null;
  skipVoteCount: number;
  skipVoteTotal: number;
  result: ResolvedAnswer | null;
  pausedMessage: string | null;
}

export interface GameSettings {
  mode: GameMode;
  questionCount: number;
  timerSeconds: number;
  teams: Record<TeamId, Pick<TeamState, 'name' | 'color' | 'roster'>>;
}

export interface ControllerInvite {
  role: ControllerRole;
  token: string;
}

export interface ControllerSession {
  controllerId: string;
  deviceId: string;
  role: ControllerRole;
  reconnectToken: string;
  playerId?: string;
  name?: string;
}

export type Ack<T = undefined> = (response: { ok: true; data: T } | { ok: false; error: string }) => void;

export interface ClientToServerEvents {
  'host:claim': (ack: Ack<ControllerInvite[]>) => void;
  'host:prepare': (payload: { settings: GameSettings; questionIds: string[] }, ack: Ack<ControllerInvite[]>) => void;
  'host:begin': (ack: Ack) => void;
  'host:answer': (payload: { answerId: string }, ack: Ack) => void;
  'host:next': (ack: Ack) => void;
  'host:pause': (ack: Ack) => void;
  'host:resume': (ack: Ack) => void;
  'host:lockRoster': (ack: Ack) => void;
  'host:unlockRoster': (ack: Ack) => void;
  'host:removePlayer': (payload: { playerId: string }, ack: Ack) => void;
  'host:reset': (ack: Ack) => void;
  'controller:join': (payload: { role: ControllerRole; token: string; deviceId: string; name?: string; reconnectToken?: string }, ack: Ack<ControllerSession>) => void;
  'controller:buzz': (payload: { questionId: string }, ack: Ack) => void;
  'controller:answer': (payload: { questionId: string; answerId: string }, ack: Ack) => void;
  'controller:skipVote': (payload: { questionId: string }, ack: Ack<boolean>) => void;
  'controller:setReady': (payload: { ready: boolean }, ack: Ack<boolean>) => void;
  'state:request': () => void;
}

export interface ServerToClientEvents {
  state: (state: PublicGameState) => void;
  notice: (message: string) => void;
}
