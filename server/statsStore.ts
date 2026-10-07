import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AnsweredStats, Difficulty } from '../shared/types.js';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * Running count of questions answered, by difficulty, persisted to a JSON file.
 * Persistence is best-effort: a missing, corrupt or unwritable file never breaks the game.
 */
export class StatsStore {
  private readonly counts: AnsweredStats = { easy: 0, medium: 0, hard: 0 };

  constructor(private readonly filePath: string) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<Record<Difficulty, unknown>>;
      for (const difficulty of DIFFICULTIES) {
        const value = parsed[difficulty];
        if (typeof value === 'number' && Number.isInteger(value) && value > 0) this.counts[difficulty] = value;
      }
    } catch {
      // No history yet, or an unreadable file: start from zero.
    }
  }

  snapshot(): AnsweredStats { return { ...this.counts }; }

  record(difficulty: Difficulty): void {
    this.counts[difficulty] += 1;
    this.save();
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      writeFileSync(temp, JSON.stringify(this.counts));
      renameSync(temp, this.filePath);
    } catch (error) {
      console.warn('Could not save question stats:', error instanceof Error ? error.message : error);
    }
  }
}
