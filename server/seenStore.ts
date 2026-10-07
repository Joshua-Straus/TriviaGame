import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface SeenQuestions {
  has(id: string): boolean;
  add(id: string): void;
}

/**
 * Remembers which question ids have been shown on screen, persisted to a JSON file.
 * Persistence is best-effort: a missing, corrupt or unwritable file never breaks the game.
 */
export class SeenQuestionStore implements SeenQuestions {
  private readonly ids = new Set<string>();

  constructor(private readonly filePath: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf8'));
      if (Array.isArray(parsed)) for (const id of parsed) if (typeof id === 'string') this.ids.add(id);
    } catch {
      // No history yet, or an unreadable file: start empty.
    }
  }

  get size(): number { return this.ids.size; }

  has(id: string): boolean { return this.ids.has(id); }

  add(id: string): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.save();
  }

  private save(): void {
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      writeFileSync(temp, JSON.stringify([...this.ids]));
      renameSync(temp, this.filePath);
    } catch (error) {
      console.warn('Could not save seen-question history:', error instanceof Error ? error.message : error);
    }
  }
}
