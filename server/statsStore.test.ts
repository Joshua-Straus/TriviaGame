import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StatsStore } from './statsStore.js';

describe('StatsStore', () => {
  const dirs: string[] = [];
  const file = () => { const dir = mkdtempSync(path.join(tmpdir(), 'stats-')); dirs.push(dir); return path.join(dir, 'nested', 'stats.json'); };
  afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });

  it('counts by difficulty, persists, and reloads', () => {
    const filePath = file(); const store = new StatsStore(filePath);
    store.record('easy'); store.record('hard'); store.record('hard');
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({ easy: 1, medium: 0, hard: 2 });
    expect(new StatsStore(filePath).snapshot()).toEqual({ easy: 1, medium: 0, hard: 2 });
  });

  it('starts from zero on a missing or corrupt file and ignores bad values', () => {
    expect(new StatsStore(file()).snapshot()).toEqual({ easy: 0, medium: 0, hard: 0 });
    const filePath = file(); new StatsStore(filePath).record('easy');
    writeFileSync(filePath, JSON.stringify({ easy: -3, medium: 'x', hard: 4 }));
    expect(new StatsStore(filePath).snapshot()).toEqual({ easy: 0, medium: 0, hard: 4 });
  });

  it('keeps working in memory when the file cannot be written', () => {
    const store = new StatsStore('/dev/null/blocked/stats.json'); store.record('medium');
    expect(store.snapshot().medium).toBe(1);
  });
});
