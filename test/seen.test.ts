import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  MAX_UNDATED_ENTRIES,
  datesFromFirstSeen,
  loadLastRun,
  loadSeen,
  rememberKeys,
  saveLastRun,
  saveSeen,
} from '../src/seen.ts';
import type { SeenStore } from '../src/seen.ts';
import type { RawEntry } from '../src/types.ts';

function makeEntry(n: number): RawEntry {
  return { title: `T${n}`, link: `https://example.com/${n}`, date: null, description: '' };
}

function withTempDir(run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), 'news-feed-test-'));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('datesFromFirstSeen: an unseen URL gets the current time and is stored', () => {
  const seen: SeenStore = {};
  const now = new Date('2026-10-26T10:00:00Z');
  const result = datesFromFirstSeen([makeEntry(1)], seen, now);
  assert.equal(result[0].date?.toISOString(), '2026-10-26T10:00:00.000Z');
  assert.equal(Object.keys(seen).length, 1);
});

test('datesFromFirstSeen: a seen URL keeps its first-seen time', () => {
  const seen: SeenStore = { 'example.com/1': '2026-10-24T08:00:00.000Z' };
  const result = datesFromFirstSeen([makeEntry(1)], seen, new Date('2026-10-26T10:00:00Z'));
  assert.equal(result[0].date?.toISOString(), '2026-10-24T08:00:00.000Z');
});

test('datesFromFirstSeen: only the top of the feed is used', () => {
  const entries: RawEntry[] = [];
  for (let n = 0; n < MAX_UNDATED_ENTRIES + 10; n++) {
    entries.push(makeEntry(n));
  }
  const result = datesFromFirstSeen(entries, {}, new Date('2026-10-26T10:00:00Z'));
  assert.equal(result.length, MAX_UNDATED_ENTRIES);
});

test('rememberKeys keeps the first time of a key', () => {
  const seen: SeenStore = { 'a.de/1': '2026-10-20T00:00:00.000Z' };
  rememberKeys(seen, ['a.de/1', 'b.de/2'], new Date('2026-10-26T10:00:00Z'));
  assert.equal(seen['a.de/1'], '2026-10-20T00:00:00.000Z');
  assert.equal(seen['b.de/2'], '2026-10-26T10:00:00.000Z');
});

test('saveSeen drops entries older than 14 days and the file round-trips', () => {
  withTempDir((dir) => {
    const path = join(dir, 'state', 'seen.json');
    const now = new Date('2026-10-26T10:00:00Z');
    saveSeen(path, { 'old.de/1': '2026-10-01T00:00:00.000Z', 'new.de/1': '2026-10-25T00:00:00.000Z' }, now);
    assert.deepEqual(loadSeen(path), { 'new.de/1': '2026-10-25T00:00:00.000Z' });
  });
});

test('saveSeen writes keys in sorted order, so equal state gives an equal file', () => {
  withTempDir((dir) => {
    const now = new Date('2026-10-26T10:00:00Z');
    saveSeen(join(dir, 'a.json'), { 'b.de': '2026-10-25T00:00:00.000Z', 'a.de': '2026-10-25T00:00:00.000Z' }, now);
    saveSeen(join(dir, 'b.json'), { 'a.de': '2026-10-25T00:00:00.000Z', 'b.de': '2026-10-25T00:00:00.000Z' }, now);
    assert.equal(readFileSync(join(dir, 'a.json'), 'utf8'), readFileSync(join(dir, 'b.json'), 'utf8'));
  });
});

test('loadSeen on a missing file starts empty', () => {
  assert.deepEqual(loadSeen(join(tmpdir(), 'news-feed-does-not-exist.json')), {});
});

test('last run round-trips; a missing or broken file means no last run', () => {
  withTempDir((dir) => {
    const path = join(dir, 'state', 'last_run.json');
    assert.equal(loadLastRun(path), null);
    saveLastRun(path, new Date('2026-10-26T05:15:00Z'));
    assert.equal(loadLastRun(path)?.toISOString(), '2026-10-26T05:15:00.000Z');
  });
});
