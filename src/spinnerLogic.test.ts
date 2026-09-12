import { describe, expect, it } from 'vitest';
import { assignInAlternatingOrder } from './spinnerLogic';

describe('spinner team assignment', () => {
  it('alternates players between teams', () => {
    expect(assignInAlternatingOrder(['A', 'B', 'C', 'D'])).toEqual({ one: ['A', 'C'], two: ['B', 'D'] });
  });

  it('gives Team 1 the extra player for an odd count', () => {
    expect(assignInAlternatingOrder(['A', 'B', 'C'])).toEqual({ one: ['A', 'C'], two: ['B'] });
  });
});
