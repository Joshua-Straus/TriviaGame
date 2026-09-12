import { randomUUID } from 'node:crypto';
import type { ControllerInvite, ControllerRole, ControllerSession, GamePhase, GameSettings, LeaderboardEntry, PublicGameState, StoredQuestion, TeamId } from '../shared/types.js';

const ROLES: ControllerRole[] = ['solo', 'one', 'two', 'individual'];
const DEFAULT_TEAMS = {
  one: { id: 'one' as const, name: 'Team Aurora', color: '#8b5cf6', score: 0, connected: false, controllerCount: 0, roster: [] },
  two: { id: 'two' as const, name: 'Team Comet', color: '#14b8a6', score: 0, connected: false, controllerCount: 0, roster: [] },
};

interface InternalController extends ControllerSession { socketId: string | null; inviteToken: string; }
interface InternalPlayer {
  id: string; name: string; normalizedName: string; controllerId: string;
  score: number; correctAnswers: number; totalResponseMs: number; responseCount: number; ready: boolean;
}

function initialState(): PublicGameState {
  return {
    phase: 'setup', mode: 'free', questionCount: 10, timerSeconds: 30,
    questionIndex: 0, question: null, remainingMs: 30_000, resolutionRemainingMs: 0, buzzDelayRemainingMs: 0,
    rosterLocked: false,
    soloConnected: false, teams: structuredClone(DEFAULT_TEAMS), buzzedTeam: null, answeringTeam: null,
    buzzedPlayerId: null, answeringPlayerId: null, wrongAnswerIds: [],
    controllerFeedback: { solo: null, one: null, two: null, individual: null },
    individualFeedback: {}, individualPlayers: [], leaderboard: null,
    skipVoteCount: 0, skipVoteTotal: 0, result: null, pausedMessage: null,
  };
}

export class GameEngine {
  private state = initialState();
  private questions: StoredQuestion[] = [];
  private questionTimer: NodeJS.Timeout | null = null;
  private resolutionTimer: NodeJS.Timeout | null = null;
  private buzzTimer: NodeJS.Timeout | null = null;
  private questionDeadline = 0;
  private resolutionDeadline = 0;
  private buzzDeadline = 0;
  private pausedFrom: GamePhase | null = null;
  private hostSocketId: string | null = null;
  private invites: Record<ControllerRole, string> = { solo: '', one: '', two: '', individual: '' };
  private controllers = new Map<string, InternalController>();
  private socketControllers = new Map<string, string>();
  private players = new Map<string, InternalPlayer>();
  private skipVotes = new Set<string>();
  private individualBuzzResponseMs = 0;

  constructor(private readonly onState: (state: PublicGameState) => void) {}

  snapshot(): PublicGameState { this.syncRemaining(); return structuredClone(this.state); }

  claimHost(socketId: string): ControllerInvite[] {
    if (!this.hostSocketId) this.hostSocketId = socketId;
    if (this.hostSocketId !== socketId) throw new Error('Another host display is already connected.');
    return ROLES.filter((role) => Boolean(this.invites[role])).map((role) => ({ role, token: this.invites[role] }));
  }

  assertHost(socketId: string): void { if (this.hostSocketId !== socketId) throw new Error('This action is only available on the host display.'); }

  prepare(settings: GameSettings, questions: StoredQuestion[], socketId: string): ControllerInvite[] {
    this.stopAllTimers(); this.hostSocketId = socketId; this.questions = questions;
    this.controllers.clear(); this.socketControllers.clear(); this.players.clear(); this.skipVotes.clear();
    this.invites = { solo: randomUUID(), one: randomUUID(), two: randomUUID(), individual: randomUUID() };
    this.state = {
      ...initialState(), phase: 'lobby', mode: settings.mode, questionCount: questions.length,
      timerSeconds: settings.timerSeconds, remainingMs: settings.timerSeconds * 1000,
      teams: {
        one: { id: 'one', ...settings.teams.one, score: 0, connected: false, controllerCount: 0 },
        two: { id: 'two', ...settings.teams.two, score: 0, connected: false, controllerCount: 0 },
      },
    };
    this.emit();
    const roles: ControllerRole[] = settings.mode === 'free' ? ['solo'] : settings.mode === 'teams' ? ['one', 'two'] : ['individual'];
    return roles.map((role) => ({ role, token: this.invites[role] }));
  }

  begin(): void {
    if (this.state.phase !== 'lobby') throw new Error('The game is not waiting to begin.');
    if (this.state.mode === 'teams' && (!this.state.teams.one.connected || !this.state.teams.two.connected)) throw new Error('At least one controller from each team must be connected.');
    if (this.state.mode === 'individuals' && (!this.state.rosterLocked || !this.allIndividualsReady())) throw new Error('Lock the roster and wait for every player to be ready.');
    this.state.questionIndex = 0; this.openQuestion();
  }

  lockRoster(): void {
    if (this.state.mode !== 'individuals' || this.state.phase !== 'lobby') throw new Error('The individual roster cannot be locked right now.');
    if (this.players.size < 2) throw new Error('At least two players must join before locking the roster.');
    this.state.rosterLocked = true;
    if (!this.maybeStartIndividuals()) this.emit();
  }

  unlockRoster(): void {
    if (this.state.mode !== 'individuals' || this.state.phase !== 'lobby') throw new Error('The roster can only be unlocked before the game starts.');
    this.state.rosterLocked = false;
    for (const player of this.players.values()) player.ready = false;
    this.refreshConnections(); this.emit();
  }

  removePlayer(playerId: string): void {
    if (this.state.mode !== 'individuals' || this.state.phase !== 'lobby' || this.state.rosterLocked) throw new Error('Players can only be removed before the roster is locked.');
    const player = this.players.get(playerId);
    if (!player) throw new Error('Player not found.');
    const controller = this.controllers.get(player.controllerId);
    if (controller?.socketId) this.socketControllers.delete(controller.socketId);
    this.controllers.delete(player.controllerId); this.skipVotes.delete(player.controllerId); this.players.delete(playerId);
    this.refreshConnections(); this.emit();
  }

  setReady(socketId: string, ready: boolean): boolean {
    if (this.state.mode !== 'individuals' || this.state.phase !== 'lobby') throw new Error('Readiness can only change in the individual lobby.');
    const controller = this.controllerForSocket(socketId);
    if (controller?.role !== 'individual' || !controller.playerId) throw new Error('Join as a player before getting ready.');
    const player = this.players.get(controller.playerId);
    if (!player) throw new Error('Player not found.');
    player.ready = ready; this.refreshConnections();
    if (!this.maybeStartIndividuals()) this.emit();
    return ready;
  }

  joinController(payload: { role: ControllerRole; token: string; deviceId: string; name?: string; reconnectToken?: string }, socketId: string): ControllerSession {
    const expected: ControllerRole[] = this.state.mode === 'free' ? ['solo'] : this.state.mode === 'teams' ? ['one', 'two'] : ['individual'];
    if (!expected.includes(payload.role) || !this.invites[payload.role] || this.invites[payload.role] !== payload.token) throw new Error('This controller link is invalid or expired.');
    if (!payload.deviceId || payload.deviceId.length > 100) throw new Error('A valid device identifier is required.');
    const existingDevice = [...this.controllers.values()].find((item) => item.deviceId === payload.deviceId && item.role === payload.role && item.inviteToken === payload.token);
    if (existingDevice) {
      this.attachController(existingDevice, socketId); this.refreshConnections(); if (!this.maybeStartIndividuals()) this.emit(); return this.publicSession(existingDevice);
    }
    if (payload.reconnectToken) {
      const controller = [...this.controllers.values()].find((item) => item.reconnectToken === payload.reconnectToken && item.role === payload.role);
      if (!controller) throw new Error('This reconnect token is invalid or expired.');
      this.attachController(controller, socketId); this.refreshConnections(); if (!this.maybeStartIndividuals()) this.emit(); return this.publicSession(controller);
    }
    if (payload.role === 'individual') {
      if (this.state.phase !== 'lobby') throw new Error('New players cannot join after the game starts.');
      if (this.players.size >= 12) throw new Error('This game already has 12 players.');
      const name = (payload.name ?? '').trim();
      if (!name || name.length > 24) throw new Error('Enter a name from 1 to 24 characters.');
      const normalizedName = name.toLocaleLowerCase();
      if ([...this.players.values()].some((player) => player.normalizedName === normalizedName)) throw new Error('That name is already taken.');
      if (this.state.rosterLocked) throw new Error('The roster is locked. New players cannot join.');
      const controller = this.createController('individual', payload.deviceId, payload.token, socketId);
      const player: InternalPlayer = { id: randomUUID(), name, normalizedName, controllerId: controller.controllerId, score: 0, correctAnswers: 0, totalResponseMs: 0, responseCount: 0, ready: false };
      controller.playerId = player.id; controller.name = player.name; this.players.set(player.id, player);
      this.refreshConnections(); this.emit(); return this.publicSession(controller);
    }
    if (payload.role === 'solo' && [...this.controllers.values()].some((item) => item.role === 'solo')) throw new Error('A solo controller is already registered. Reopen this page to reconnect.');
    const controller = this.createController(payload.role, payload.deviceId, payload.token, socketId);
    this.refreshConnections(); this.emit(); return this.publicSession(controller);
  }

  controllerBuzz(socketId: string, questionId: string): void {
    const controller = this.controllerForSocket(socketId);
    if (!controller) throw new Error('Join the game before buzzing.');
    if (this.state.phase !== 'question' || !['teams', 'individuals'].includes(this.state.mode)) throw new Error('Buzzing is not currently open.');
    if (this.state.question?.id !== questionId) throw new Error('That buzz belongs to an earlier question.');
    this.syncRemaining(); if (this.state.remainingMs <= 0) return this.timeoutQuestion();
    this.stopQuestionTimer(); this.clearSkipVotes(); this.state.phase = 'buzz_locked';
    if (this.state.mode === 'teams') {
      if (controller.role !== 'one' && controller.role !== 'two') throw new Error('This is not a team controller.');
      this.state.buzzedTeam = controller.role; this.state.answeringTeam = controller.role;
    } else {
      if (controller.role !== 'individual' || !controller.playerId) throw new Error('This is not an individual player controller.');
      this.state.buzzedPlayerId = controller.playerId; this.state.answeringPlayerId = controller.playerId;
      this.individualBuzzResponseMs = Math.max(0, this.state.timerSeconds * 1000 - this.state.remainingMs);
    }
    this.state.buzzDelayRemainingMs = 1_500;
    this.startBuzzTimer();
  }

  hostAnswer(answerId: string): void { if (this.state.mode !== 'free') throw new Error('The host can only answer in Free Play.'); this.answer(answerId, null); }

  controllerAnswer(socketId: string, questionId: string, answerId: string): void {
    const controller = this.controllerForSocket(socketId);
    if (!controller) throw new Error('Join the game before answering.');
    if (this.state.question?.id !== questionId) throw new Error('That answer belongs to an earlier question.');
    this.answer(answerId, controller);
  }

  toggleSkipVote(socketId: string, questionId: string): boolean {
    const controller = this.controllerForSocket(socketId);
    if (!controller) throw new Error('Join the game before voting.');
    if (this.state.phase !== 'question' || !['teams', 'individuals'].includes(this.state.mode)) throw new Error('Skip voting is closed.');
    if (this.state.question?.id !== questionId) throw new Error('That vote belongs to an earlier question.');
    if (this.state.mode === 'teams' && controller.role !== 'one' && controller.role !== 'two') throw new Error('This controller cannot vote.');
    if (this.state.mode === 'individuals' && controller.role !== 'individual') throw new Error('This controller cannot vote.');
    const voted = !this.skipVotes.has(controller.controllerId);
    if (voted) this.skipVotes.add(controller.controllerId); else this.skipVotes.delete(controller.controllerId);
    this.refreshVoteTotals(); if (this.hasSkipConsensus()) this.resolve(null, null, 'skipped'); else this.emit(); return voted;
  }

  next(): void { if (this.state.phase !== 'resolved') throw new Error('Resolve the current question before continuing.'); this.advanceQuestion(); }

  pause(message = 'Game paused by host.'): void {
    if (!['question', 'buzz_locked', 'answering', 'steal'].includes(this.state.phase)) throw new Error('The game cannot be paused right now.');
    this.syncRemaining(); this.stopAllTimers(); this.pausedFrom = this.state.phase; this.state.phase = 'paused'; this.state.pausedMessage = message; this.emit();
  }

  resume(): void {
    if (this.state.phase !== 'paused' || !this.pausedFrom) throw new Error('The game is not paused.');
    if (this.state.mode === 'teams' && (!this.state.teams.one.connected || !this.state.teams.two.connected)) throw new Error('Both teams need a connected controller.');
    this.state.phase = this.pausedFrom; this.state.pausedMessage = null;
    const resumePhase = this.state.phase; this.pausedFrom = null;
    if (['question', 'steal'].includes(resumePhase)) this.startQuestionTimer();
    else if (resumePhase === 'buzz_locked') this.startBuzzTimer();
    else this.emit();
  }

  reset(): void {
    this.stopAllTimers(); this.questions = []; this.controllers.clear(); this.socketControllers.clear(); this.players.clear(); this.skipVotes.clear();
    this.invites = { solo: '', one: '', two: '', individual: '' }; this.state = initialState(); this.emit();
  }

  disconnect(socketId: string): void {
    if (this.hostSocketId === socketId) this.hostSocketId = null;
    const controllerId = this.socketControllers.get(socketId); if (!controllerId) return;
    this.socketControllers.delete(socketId); const controller = this.controllers.get(controllerId);
    if (!controller || controller.socketId !== socketId) return;
    controller.socketId = null; this.skipVotes.delete(controllerId); this.refreshConnections(); this.refreshVoteTotals();
    if (this.state.mode === 'teams' && ['question', 'buzz_locked', 'answering', 'steal'].includes(this.state.phase) && (!this.state.teams.one.connected || !this.state.teams.two.connected)) {
      const missing = !this.state.teams.one.connected ? this.state.teams.one.name : this.state.teams.two.name;
      this.pause(`Waiting for ${missing} to reconnect…`); return;
    }
    if (this.state.mode === 'individuals' && ['buzz_locked', 'answering'].includes(this.state.phase) && controller.playerId === this.state.buzzedPlayerId) {
      this.pause(`Waiting for ${controller.name ?? 'the answering player'} to reconnect…`); return;
    }
    if (this.state.phase === 'question' && this.hasSkipConsensus()) this.resolve(null, null, 'skipped'); else this.emit();
  }

  private answer(answerId: string, controller: InternalController | null): void {
    const question = this.currentQuestion();
    if (!question.answers.some((answer) => answer.id === answerId)) throw new Error('That answer is not available.');
    if (this.state.wrongAnswerIds.includes(answerId)) throw new Error('That answer has already been tried.');
    if (this.state.mode === 'free') {
      if (this.state.phase !== 'question' || (controller && controller.role !== 'solo')) throw new Error('Answers are not currently open.');
    } else if (this.state.mode === 'teams') {
      if (!controller || (controller.role !== 'one' && controller.role !== 'two') || !['answering', 'steal'].includes(this.state.phase) || this.state.answeringTeam !== controller.role) throw new Error('It is not this team’s turn to answer.');
    } else if (!controller?.playerId || controller.playerId !== this.state.answeringPlayerId || this.state.phase !== 'answering') throw new Error('It is not this player’s turn to answer.');
    this.stopAllTimers(); const correct = answerId === question.correctAnswerId;
    if (this.state.mode === 'free') this.state.controllerFeedback.solo = correct ? 'correct' : 'incorrect';
    if (this.state.mode === 'teams' && controller && (controller.role === 'one' || controller.role === 'two')) {
      this.state.controllerFeedback[controller.role] = correct ? 'correct' : 'incorrect'; this.state.teams[controller.role].score += correct ? 1 : -1;
    }
    if (this.state.mode === 'individuals' && controller?.playerId) {
      const player = this.players.get(controller.playerId)!; this.state.individualFeedback[player.id] = correct ? 'correct' : 'incorrect'; player.score += correct ? 1 : -1;
      if (correct) { player.correctAnswers += 1; player.totalResponseMs += this.individualBuzzResponseMs; player.responseCount += 1; }
    }
    if (correct) { this.resolve(answerId, controller?.role === 'one' || controller?.role === 'two' ? controller.role : null, 'correct'); return; }
    this.state.wrongAnswerIds.push(answerId);
    if (this.state.mode === 'teams' && this.state.phase === 'answering' && controller && (controller.role === 'one' || controller.role === 'two')) {
      const other: TeamId = controller.role === 'one' ? 'two' : 'one'; this.state.phase = 'steal'; this.state.answeringTeam = other; this.state.buzzedTeam = other; this.startQuestionTimer(); return;
    }
    this.resolve(answerId, controller?.role === 'one' || controller?.role === 'two' ? controller.role : null, 'incorrect');
  }

  private openQuestion(): void {
    const question = this.currentQuestion(); this.state.phase = 'question';
    this.state.question = { id: question.id, category: question.category, difficulty: question.difficulty, question: question.question, answers: question.answers };
    this.state.remainingMs = this.state.timerSeconds * 1000; this.state.resolutionRemainingMs = 0; this.state.buzzDelayRemainingMs = 0;
    this.state.buzzedTeam = null; this.state.answeringTeam = null; this.state.buzzedPlayerId = null; this.state.answeringPlayerId = null;
    this.state.wrongAnswerIds = []; this.state.controllerFeedback = { solo: null, one: null, two: null, individual: null };
    this.state.individualFeedback = {}; this.state.result = null; this.state.pausedMessage = null; this.clearSkipVotes(); this.startQuestionTimer();
  }

  private resolve(selectedAnswerId: string | null, teamId: TeamId | null, reason: 'correct' | 'incorrect' | 'timeout' | 'skipped'): void {
    if (!['question', 'answering', 'steal'].includes(this.state.phase)) throw new Error('This question has already been resolved.');
    const question = this.currentQuestion(); this.stopAllTimers(); this.clearSkipVotes(); this.state.phase = 'resolved'; this.state.answeringTeam = null; this.state.answeringPlayerId = null; this.state.buzzDelayRemainingMs = 0;
    this.state.result = { selectedAnswerId, correctAnswerId: question.correctAnswerId, teamId, reason }; this.state.resolutionRemainingMs = 5_000; this.startResolutionTimer();
  }

  private advanceQuestion(): void {
    this.stopAllTimers();
    if (this.state.questionIndex >= this.questions.length - 1) {
      this.state.phase = 'complete'; this.state.question = null; this.state.answeringTeam = null; this.state.buzzedTeam = null;
      this.state.answeringPlayerId = null; this.state.buzzedPlayerId = null; this.state.resolutionRemainingMs = 0;
      if (this.state.mode === 'individuals') this.state.leaderboard = this.buildLeaderboard(); this.emit(); return;
    }
    this.state.questionIndex += 1; this.openQuestion();
  }

  private buildLeaderboard(): LeaderboardEntry[] {
    const average = (player: InternalPlayer) => player.responseCount ? Math.round(player.totalResponseMs / player.responseCount) : null;
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score || b.correctAnswers - a.correctAnswers || (average(a) ?? Infinity) - (average(b) ?? Infinity) || a.name.localeCompare(b.name));
    let rank = 0;
    return sorted.map((player, index) => {
      const prior = index ? sorted[index - 1] : null; const avg = average(player);
      if (!prior || player.score !== prior.score || player.correctAnswers !== prior.correctAnswers || avg !== average(prior)) rank = index + 1;
      return { playerId: player.id, name: player.name, rank, score: player.score, correctAnswers: player.correctAnswers, averageResponseMs: avg };
    });
  }

  private currentQuestion(): StoredQuestion { const question = this.questions[this.state.questionIndex]; if (!question) throw new Error('No active question is available.'); return question; }
  private createController(role: ControllerRole, deviceId: string, inviteToken: string, socketId: string): InternalController {
    const controller: InternalController = { controllerId: randomUUID(), deviceId, role, reconnectToken: randomUUID(), inviteToken, socketId };
    this.controllers.set(controller.controllerId, controller); this.socketControllers.set(socketId, controller.controllerId); return controller;
  }
  private attachController(controller: InternalController, socketId: string): void { if (controller.socketId) this.socketControllers.delete(controller.socketId); controller.socketId = socketId; this.socketControllers.set(socketId, controller.controllerId); }
  private publicSession(controller: InternalController): ControllerSession { const { socketId: _socketId, inviteToken: _inviteToken, ...session } = controller; return session; }
  private controllerForSocket(socketId: string): InternalController | null { const id = this.socketControllers.get(socketId); return id ? this.controllers.get(id) ?? null : null; }

  private refreshConnections(): void {
    for (const teamId of ['one', 'two'] as TeamId[]) {
      const count = [...this.controllers.values()].filter((controller) => controller.role === teamId && controller.socketId).length;
      this.state.teams[teamId].controllerCount = count; this.state.teams[teamId].connected = count > 0;
    }
    this.state.soloConnected = [...this.controllers.values()].some((controller) => controller.role === 'solo' && controller.socketId);
    this.state.individualPlayers = [...this.players.values()].map((player) => ({ id: player.id, name: player.name, connected: Boolean(this.controllers.get(player.controllerId)?.socketId), ready: player.ready }));
    this.refreshVoteTotals();
  }

  private eligibleVoters(): InternalController[] {
    if (this.state.phase !== 'question') return [];
    return [...this.controllers.values()].filter((controller) => controller.socketId && (this.state.mode === 'teams' ? controller.role === 'one' || controller.role === 'two' : this.state.mode === 'individuals' ? controller.role === 'individual' : false));
  }
  private refreshVoteTotals(): void {
    const eligible = this.eligibleVoters(); const ids = new Set(eligible.map((item) => item.controllerId));
    for (const id of this.skipVotes) if (!ids.has(id)) this.skipVotes.delete(id);
    this.state.skipVoteCount = this.skipVotes.size; this.state.skipVoteTotal = eligible.length;
  }
  private hasSkipConsensus(): boolean {
    this.refreshVoteTotals();
    if (this.state.phase !== 'question' || !this.state.skipVoteTotal || this.state.skipVoteCount !== this.state.skipVoteTotal) return false;
    if (this.state.mode === 'teams') return this.state.teams.one.connected && this.state.teams.two.connected;
    return this.state.mode === 'individuals' && this.state.skipVoteTotal >= 2;
  }
  private allIndividualsReady(): boolean {
    return this.players.size >= 2 && [...this.players.values()].every((player) => player.ready && Boolean(this.controllers.get(player.controllerId)?.socketId));
  }
  private maybeStartIndividuals(): boolean {
    if (this.state.mode !== 'individuals' || this.state.phase !== 'lobby' || !this.state.rosterLocked || !this.allIndividualsReady()) return false;
    this.state.questionIndex = 0; this.openQuestion(); return true;
  }
  private clearSkipVotes(): void { this.skipVotes.clear(); this.state.skipVoteCount = 0; this.state.skipVoteTotal = 0; }
  private connectedIndividualCount(): number { return this.state.individualPlayers.filter((player) => player.connected).length; }
  private timeoutQuestion(): void { this.state.remainingMs = 0; this.resolve(null, null, 'timeout'); }
  private startQuestionTimer(): void {
    this.stopAllTimers(); if (this.state.remainingMs <= 0) return this.timeoutQuestion(); this.questionDeadline = Date.now() + this.state.remainingMs;
    this.questionTimer = setInterval(() => { this.syncRemaining(); if (this.state.remainingMs <= 0) this.timeoutQuestion(); else this.emit(); }, 250); this.refreshVoteTotals(); this.emit();
  }
  private startResolutionTimer(): void {
    this.stopAllTimers(); this.resolutionDeadline = Date.now() + this.state.resolutionRemainingMs;
    this.resolutionTimer = setInterval(() => { this.syncRemaining(); if (this.state.resolutionRemainingMs <= 0) this.advanceQuestion(); else this.emit(); }, 250); this.emit();
  }
  private startBuzzTimer(): void {
    this.stopAllTimers(); this.buzzDeadline = Date.now() + this.state.buzzDelayRemainingMs;
    this.buzzTimer = setInterval(() => {
      this.syncRemaining();
      if (this.state.buzzDelayRemainingMs <= 0) {
        this.stopAllTimers(); this.state.buzzDelayRemainingMs = 0; this.state.phase = 'answering'; this.emit();
      } else this.emit();
    }, 100);
    this.emit();
  }
  private syncRemaining(): void {
    if (this.questionTimer) this.state.remainingMs = Math.max(0, this.questionDeadline - Date.now());
    if (this.resolutionTimer) this.state.resolutionRemainingMs = Math.max(0, this.resolutionDeadline - Date.now());
    if (this.buzzTimer) this.state.buzzDelayRemainingMs = Math.max(0, this.buzzDeadline - Date.now());
  }
  private stopQuestionTimer(): void { if (this.questionTimer) clearInterval(this.questionTimer); this.questionTimer = null; }
  private stopAllTimers(): void {
    if (this.questionTimer) clearInterval(this.questionTimer);
    if (this.resolutionTimer) clearInterval(this.resolutionTimer);
    if (this.buzzTimer) clearInterval(this.buzzTimer);
    this.questionTimer = null; this.resolutionTimer = null; this.buzzTimer = null;
  }
  private emit(): void { this.onState(this.snapshot()); }
}
