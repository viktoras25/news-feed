import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lacksUsableDates } from '../src/filter.ts';
import { MAX_UNDATED_ENTRIES, datesFromFirstSeen } from '../src/seen.ts';
import type { SeenStore } from '../src/seen.ts';
import type { RawEntry } from '../src/types.ts';

function makeEntry(n: number, date: string | null): RawEntry {
  return { title: `T${n}`, link: `https://example.com/${n}`, date: date === null ? null : new Date(date), description: '' };
}

test('lacksUsableDates: no dates at all', () => {
  assert.equal(lacksUsableDates([makeEntry(1, null), makeEntry(2, null)]), true);
});

test('lacksUsableDates: one shared timestamp', () => {
  const entries = [1, 2, 3, 4, 5, 6].map((n) => makeEntry(n, '2026-10-26T09:39:07Z'));
  assert.equal(lacksUsableDates(entries), true);
});

test('lacksUsableDates: normal feed', () => {
  const entries = [1, 2, 3, 4, 5, 6].map((n) => makeEntry(n, `2026-10-26T0${n}:00:00Z`));
  assert.equal(lacksUsableDates(entries), false);
});

test('datesFromFirstSeen: unseen URL gets the current time and is stored', () => {
  const seen: SeenStore = {};
  const now = new Date('2026-10-26T10:00:00Z');
  const result = datesFromFirstSeen([makeEntry(1, null)], seen, now);
  assert.equal(result[0].date?.toISOString(), '2026-10-26T10:00:00.000Z');
  assert.equal(Object.keys(seen).length, 1);
});

test('datesFromFirstSeen: a seen URL keeps its first-seen time', () => {
  const seen: SeenStore = { 'example.com/1': '2026-10-24T08:00:00.000Z' };
  const now = new Date('2026-10-26T10:00:00Z');
  const result = datesFromFirstSeen([makeEntry(1, null)], seen, now);
  assert.equal(result[0].date?.toISOString(), '2026-10-24T08:00:00.000Z');
});

test('datesFromFirstSeen: only the top of the feed is used', () => {
  const entries: RawEntry[] = [];
  for (let n = 0; n < MAX_UNDATED_ENTRIES + 10; n++) {
    entries.push(makeEntry(n, null));
  }
  const result = datesFromFirstSeen(entries, {}, new Date('2026-10-26T10:00:00Z'));
  assert.equal(result.length, MAX_UNDATED_ENTRIES);
});
