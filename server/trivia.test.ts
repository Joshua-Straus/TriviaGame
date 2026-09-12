import { describe, expect, it } from 'vitest';
import { normalizeTriviaQuestions, parseQuestionLimit } from './trivia.js';

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
