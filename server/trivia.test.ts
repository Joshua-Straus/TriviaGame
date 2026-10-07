import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTriviaQuestions, normalizeTriviaQuestions, parseQuestionLimit } from './trivia.js';

const apiQuestion = {
  id: 'q1',
  category: 'science',
  difficulty: 'medium',
  type: 'text_choice',
  question: { text: 'Which planet is known as the Red Planet?' },
  correctAnswer: 'Mars',
  incorrectAnswers: ['Venus', 'Jupiter', 'Mercury'],
};

describe('trivia normalization', () => {
  it('creates safe shuffled answer options and retains a server-only answer key', () => {
    const [question] = normalizeTriviaQuestions([apiQuestion]);
    expect(question).toMatchObject({ id: 'q1', question: apiQuestion.question.text, difficulty: 'medium' });
    expect(question.answers).toHaveLength(4);
    expect(question.answers.find((answer) => answer.id === question.correctAnswerId)?.text).toBe('Mars');
  });

  it('rejects malformed and unsupported questions', () => {
    expect(() => normalizeTriviaQuestions([{ ...apiQuestion, type: 'image_choice' }])).toThrow(/malformed/i);
    expect(() => normalizeTriviaQuestions({})).toThrow(/invalid response/i);
  });
});

describe('question limit validation', () => {
  it('accepts boundary values and a default', () => {
    expect(parseQuestionLimit(undefined)).toBe(10);
    expect(parseQuestionLimit('1')).toBe(1);
    expect(parseQuestionLimit('50')).toBe(50);
  });

  it.each([0, 51, 1.5, 'nope'])('rejects invalid limit %s', (value) => {
    expect(() => parseQuestionLimit(value)).toThrow(/1 to 50/i);
  });
});

describe('fetchTriviaQuestions', () => {
  const make = (id: string, text = `Question ${id}?`) => ({ ...apiQuestion, id, question: { text } });
  const mockFetch = (...batches: unknown[][]) => {
    const fn = vi.fn();
    for (const batch of batches) fn.mockResolvedValueOnce({ ok: true, json: async () => batch });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  afterEach(() => vi.unstubAllGlobals());

  it('drops duplicates by id and by wording within a fetch', async () => {
    mockFetch([make('a'), make('a'), make('b', 'Same text?'), make('c', 'same   TEXT'), make('d')]);
    const questions = await fetchTriviaQuestions(3);
    expect(questions.map((question) => question.id)).toEqual(['a', 'b', 'd']);
  });

  it('avoids previously seen questions and does not record anything itself', async () => {
    const seen = { has: vi.fn((id: string) => id === 'a'), add: vi.fn() };
    mockFetch([make('a'), make('b'), make('c')]);
    expect((await fetchTriviaQuestions(2, seen)).map((question) => question.id)).toEqual(['b', 'c']);
    expect(seen.add).not.toHaveBeenCalled();
  });

  it('retries for more unseen questions, then falls back to seen ones', async () => {
    const seen = { has: () => true, add: vi.fn() };
    const fetchMock = mockFetch([make('a'), make('b')], [make('a'), make('b')], [make('a'), make('b')]);
    expect(await fetchTriviaQuestions(2, seen)).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('errors when too few distinct questions exist', async () => {
    mockFetch([make('a'), make('a')], [make('a')], [make('a')]);
    await expect(fetchTriviaQuestions(2)).rejects.toThrow(/Only 1 of 2/);
  });
});
