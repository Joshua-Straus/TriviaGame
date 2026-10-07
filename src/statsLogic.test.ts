import { describe, expect, it } from 'vitest';
import { donutGradient, percentOf, totalAnswered } from './statsLogic';

describe('stats logic', () => {
  it('totals and computes percentages, handling zero', () => {
    expect(totalAnswered({ easy: 2, medium: 1, hard: 1 })).toBe(4);
    expect(percentOf({ easy: 2, medium: 1, hard: 1 }, 'easy')).toBe(50);
    expect(percentOf({ easy: 0, medium: 0, hard: 0 }, 'hard')).toBe(0);
  });

  it('builds a donut with one slice per non-empty difficulty', () => {
    const gradient = donutGradient({ easy: 1, medium: 0, hard: 1 });
    expect(gradient).toContain('0deg 180deg');
    expect(gradient).toContain('180deg 360deg');
    expect(gradient).not.toContain('#e8a317');
    expect(donutGradient({ easy: 0, medium: 0, hard: 0 })).toContain('360deg');
  });
});
