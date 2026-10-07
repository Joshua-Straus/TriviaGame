import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SeenQuestionStore } from './seenStore.js';

describe('SeenQuestionStore', () => {
  const dirs: string[] = [];
  const file = (name = 'seen.json') => { const dir = mkdtempSync(path.join(tmpdir(), 'seen-')); dirs.push(dir); return path.join(dir, 'nested', name); };
  afterEach(() => { dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })); });

  it('persists added ids and reloads them', () => {
    const filePath = file(); const store = new SeenQuestionStore(filePath);
    store.add('a'); store.add('b'); store.add('a');
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(['a', 'b']);
    const reloaded = new SeenQuestionStore(filePath);
    expect(reloaded.has('a')).toBe(true); expect(reloaded.has('c')).toBe(false); expect(reloaded.size).toBe(2);
  });

  it('starts empty on a missing or corrupt file', () => {
    expect(new SeenQuestionStore(file()).size).toBe(0);
    const filePath = file(); const store = new SeenQuestionStore(filePath); store.add('x');
    writeFileSync(filePath, '{not json');
    expect(new SeenQuestionStore(filePath).size).toBe(0);
  });

  it('keeps working in memory when the file cannot be written', () => {
    const store = new SeenQuestionStore('/dev/null/blocked/seen.json');
    store.add('a'); expect(store.has('a')).toBe(true);
  });
});
