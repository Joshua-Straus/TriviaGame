import { randomInt } from 'node:crypto';
import type { Difficulty, StoredQuestion } from '../shared/types.js';
import type { SeenQuestions } from './seenStore.js';

interface ApiQuestion {
  id?: unknown;
  category?: unknown;
  difficulty?: unknown;
  type?: unknown;
  question?: { text?: unknown };
  correctAnswer?: unknown;
  incorrectAnswers?: unknown;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function normalizeTriviaQuestions(payload: unknown): StoredQuestion[] {
  if (!Array.isArray(payload)) throw new Error('Trivia service returned an invalid response.');

  return payload.map((raw, questionIndex) => {
    const item = raw as ApiQuestion;
    if (
      item.type !== 'text_choice' ||
      typeof item.id !== 'string' ||
      typeof item.category !== 'string' ||
      !['easy', 'medium', 'hard'].includes(String(item.difficulty)) ||
      typeof item.question?.text !== 'string' ||
      typeof item.correctAnswer !== 'string' ||
      !Array.isArray(item.incorrectAnswers) ||
      item.incorrectAnswers.some((answer) => typeof answer !== 'string')
    ) {
      throw new Error(`Trivia service returned a malformed question at position ${questionIndex + 1}.`);
    }

    const answerTexts = shuffle([item.correctAnswer, ...(item.incorrectAnswers as string[])]);
    const answers = answerTexts.map((text, answerIndex) => ({
      id: `${item.id}:${answerIndex}`,
      text,
    }));
    const correctAnswerId = answers.find((answer) => answer.text === item.correctAnswer)?.id;
    if (!correctAnswerId) throw new Error('Unable to identify the correct answer.');

    return {
      id: item.id,
      category: item.category,
      difficulty: item.difficulty as Difficulty,
      question: item.question.text,
      answers,
      correctAnswerId,
    };
  });
}

const MAX_API_LIMIT = 50;
const EXTRA_REQUESTED = 10;
const MAX_ATTEMPTS = 3;

function textKey(question: StoredQuestion): string {
  return question.question.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

async function requestQuestions(limit: number): Promise<StoredQuestion[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = new URL('https://the-trivia-api.com/v2/questions');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('types', 'text_choice');
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Trivia service responded with status ${response.status}.`);
    return normalizeTriviaQuestions(await response.json());
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The trivia service took too long to respond. Try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches `limit` distinct questions. Duplicates (by id or wording) are dropped, and questions
 * already in `seen` are avoided where possible. Nothing is recorded here; callers mark
 * questions as seen only once they are actually shown.
 */
export async function fetchTriviaQuestions(limit: number, seen?: SeenQuestions): Promise<StoredQuestion[]> {
  const unique = new Map<string, StoredQuestion>();
  const texts = new Set<string>();
  const isFresh = (question: StoredQuestion) => !seen?.has(question.id);
  const freshCount = () => [...unique.values()].filter(isFresh).length;

  for (let attempt = 0; attempt < MAX_ATTEMPTS && freshCount() < limit; attempt += 1) {
    const batch = await requestQuestions(Math.min(MAX_API_LIMIT, limit + EXTRA_REQUESTED));
    for (const question of batch) {
      const key = textKey(question);
      if (unique.has(question.id) || texts.has(key)) continue;
      unique.set(question.id, question);
      texts.add(key);
    }
  }

  if (unique.size < limit) {
    throw new Error(`Only ${unique.size} of ${limit} requested questions were available. Try again.`);
  }
  // Prefer unseen questions; fall back to previously seen ones only if the pool is running dry.
  const all = [...unique.values()];
  return [...all.filter(isFresh), ...all.filter((question) => !isFresh(question))].slice(0, limit);
}

export function parseQuestionLimit(value: unknown): number {
  const limit = Number(value ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Question count must be a whole number from 1 to 50.');
  }
  return limit;
}
