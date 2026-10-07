import type { AnsweredStats, Difficulty } from '../shared/types';

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'medium', 'hard'];
export const DIFFICULTY_COLORS: Record<Difficulty, string> = { easy: '#22a65a', medium: '#e8a317', hard: '#d6335f' };

export function totalAnswered(stats: AnsweredStats): number {
  return DIFFICULTY_ORDER.reduce((sum, difficulty) => sum + stats[difficulty], 0);
}

export function percentOf(stats: AnsweredStats, difficulty: Difficulty): number {
  const total = totalAnswered(stats);
  return total ? Math.round((stats[difficulty] / total) * 100) : 0;
}

export function donutGradient(stats: AnsweredStats): string {
  const total = totalAnswered(stats);
  if (!total) return 'conic-gradient(rgba(9, 58, 62, .12) 0deg 360deg)';
  let angle = 0;
  const stops = DIFFICULTY_ORDER.filter((difficulty) => stats[difficulty] > 0).map((difficulty) => {
    const start = angle;
    angle += (stats[difficulty] / total) * 360;
    return `${DIFFICULTY_COLORS[difficulty]} ${start}deg ${angle}deg`;
  });
  return `conic-gradient(${stops.join(', ')})`;
}
