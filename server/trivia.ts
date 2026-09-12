import { randomInt } from 'node:crypto';
import type { Difficulty, StoredQuestion } from '../shared/types.js';

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

export async function fetchTriviaQuestions(limit: number): Promise<StoredQuestion[]> {
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
    const questions = normalizeTriviaQuestions(await response.json());
    if (questions.length < limit) {
      throw new Error(`Only ${questions.length} of ${limit} requested questions were available. Try again.`);
    }
    return questions.slice(0, limit);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('The trivia service took too long to respond. Try again.');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function parseQuestionLimit(value: unknown): number {
  const limit = Number(value ?? 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new Error('Question count must be a whole number from 1 to 50.');
  }
  return limit;
}
