import { describe, expect, it } from 'vitest';
import { parseQuestionCountDraft } from './settings';

describe('question count input', () => {
  it('allows a draft to be replaced with 20', () => {
    expect(parseQuestionCountDraft('')).toBeNull();
    expect(parseQuestionCountDraft('2')).toBe(2);
    expect(parseQuestionCountDraft('20')).toBe(20);
  });

  it.each(['', '0', '51', '1.5', '-1', 'abc'])('rejects invalid value %s', (value) => {
    expect(parseQuestionCountDraft(value)).toBeNull();
  });

  it.each(['1', '10', '50'])('accepts valid value %s', (value) => {
    expect(parseQuestionCountDraft(value)).toBe(Number(value));
  });
});
