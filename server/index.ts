import express from 'express';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ControllerRole, ServerToClientEvents, StoredQuestion } from '../shared/types.js';
import { GameEngine } from './game.js';
import { fetchTriviaQuestions, parseQuestionLimit } from './trivia.js';

const app = express();
const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { cors: { origin: true } });
const questionCache = new Map<string, StoredQuestion>();
const engine = new GameEngine((state) => io.emit('state', state));

app.use(express.json());

app.get('/api/network', (_request, response) => {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address);
  response.json({ addresses });
});

app.get('/api/questions', async (request, response) => {
  const rawLimit = Array.isArray(request.query.limit) ? request.query.limit[0] : request.query.limit;
  try {
    const limit = parseQuestionLimit(rawLimit);
    const questions = await fetchTriviaQuestions(limit);
    for (const question of questions) questionCache.set(question.id, question);
    response.json(
      questions.map(({ correctAnswerId: _correctAnswerId, ...safeQuestion }) => safeQuestion),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load trivia questions.';
    response.status(message.includes('whole number') ? 400 : 502).json({ error: message });
  }
});

function reply<T>(ack: (value: { ok: true; data: T } | { ok: false; error: string }) => void, action: () => T | void): void {
  if (typeof ack !== 'function') return;
  try {
    ack({ ok: true, data: action() as T });
  } catch (error) {
    ack({ ok: false, error: error instanceof Error ? error.message : 'Unexpected game error.' });
  }
}

io.on('connection', (socket) => {
  socket.emit('state', engine.snapshot());
  socket.on('state:request', () => socket.emit('state', engine.snapshot()));
  socket.on('host:claim', (ack) => reply(ack, () => engine.claimHost(socket.id)));
  socket.on('host:prepare', ({ settings, questionIds }, ack) =>
    reply(ack, () => {
      if (!Number.isInteger(settings.questionCount) || settings.questionCount < 1 || settings.questionCount > 50) {
        throw new Error('Question count must be between 1 and 50.');
      }
      if (!Number.isInteger(settings.timerSeconds) || settings.timerSeconds < 5 || settings.timerSeconds > 120) {
        throw new Error('Timer must be between 5 and 120 seconds.');
      }
      const questions = questionIds.map((id) => questionCache.get(id)).filter((item): item is StoredQuestion => Boolean(item));
      if (questions.length !== settings.questionCount) throw new Error('Some questions expired. Load a fresh set and try again.');
      return engine.prepare(settings, questions, socket.id);
    }),
  );
  socket.on('host:begin', (ack) => reply(ack, () => { engine.assertHost(socket.id); engine.begin(); }));
  socket.on('host:answer', ({ answerId }, ack) => reply(ack, () => { engine.assertHost(socket.id); engine.hostAnswer(answerId); }));
  socket.on('host:next', (ack) => reply(ack, () => { engine.assertHost(socket.id); engine.next(); }));
  socket.on('host:pause', (ack) => reply(ack, () => { engine.assertHost(socket.id); engine.pause(); }));
  socket.on('host:resume', (ack) => reply(ack, () => { engine.assertHost(socket.id); engine.resume(); }));
  socket.on('host:lockRoster', (ack) => reply(ack, () => { engine.assertHost(socket.id); engine.lockRoster(); }));
  socket.on('host:unlockRoster', (ack) => reply(ack, () => { engine.assertHost(socket.id); engine.unlockRoster(); }));
  socket.on('host:removePlayer', ({ playerId }, ack) => reply(ack, () => { engine.assertHost(socket.id); engine.removePlayer(playerId); }));
  socket.on('host:reset', (ack) => reply(ack, () => { engine.assertHost(socket.id); engine.reset(); }));
  socket.on('controller:join', (payload, ack) =>
    reply(ack, () => {
      if (!(['solo', 'one', 'two', 'individual'] as ControllerRole[]).includes(payload.role)) throw new Error('Unknown controller role.');
      return engine.joinController(payload, socket.id);
    }),
  );
  socket.on('controller:buzz', ({ questionId }, ack) =>
    reply(ack, () => {
      engine.controllerBuzz(socket.id, questionId);
    }),
  );
  socket.on('controller:answer', ({ questionId, answerId }, ack) =>
    reply(ack, () => {
      engine.controllerAnswer(socket.id, questionId, answerId);
    }),
  );
  socket.on('controller:skipVote', ({ questionId }, ack) =>
    reply(ack, () => engine.toggleSkipVote(socket.id, questionId)),
  );
  socket.on('controller:setReady', ({ ready }, ack) =>
    reply(ack, () => engine.setReady(socket.id, ready)),
  );
  socket.on('disconnect', () => engine.disconnect(socket.id));
});

if (process.env.NODE_ENV === 'production') {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const clientDir = path.resolve(currentDir, '../../dist');
  app.use(express.static(clientDir));
  app.use((_request, response) => response.sendFile(path.join(clientDir, 'index.html')));
}

const port = Number(process.env.PORT ?? 3000);
httpServer.listen(port, '0.0.0.0', () => {
  const addresses = Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}`);
  console.log(`Host display: http://localhost:${port}`);
  for (const address of addresses) console.log(`LAN access:   ${address}`);
});
