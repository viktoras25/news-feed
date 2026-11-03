import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { feedWeekStats, loadArchive } from '../src/history.ts';
import type { ArchivedEntry } from '../src/history.ts';

const entry = (...sources: [string, string][]): ArchivedEntry => sources.map(([name, key]) => ({ name, key }));

test('week stats: distinct URLs per feed, unique vs shared, the most overlapping feed', () => {
  const entries = [
    entry(['heise', 'heise.de/1'], ['heise iX', 'heise.de/1']),
    entry(['heise', 'heise.de/2'], ['heise iX', 'heise.de/2']),
    entry(['heise', 'heise.de/3']),
    entry(['heise iX', 'heise.de/ix/4'], ['Golem', 'golem.de/4']),
    // the same entry again on the next day (seen_before) is not counted twice
    entry(['heise', 'heise.de/1'], ['heise iX', 'heise.de/1']),
  ];
  const [heise, ix, golem, absent] = feedWeekStats(entries, ['heise', 'heise iX', 'Golem', 'BMAS']);
  assert.deepEqual(heise, { name: 'heise', entries: 3, unique: 1, shared: 2, mostSharedWith: 'heise iX (2)' });
  assert.deepEqual(ix, { name: 'heise iX', entries: 3, unique: 0, shared: 3, mostSharedWith: 'heise (2)' });
  assert.equal(golem.shared, 1);
  assert.deepEqual(absent, { name: 'BMAS', entries: 0, unique: 0, shared: 0, mostSharedWith: '' });
});

test('loadArchive reads every day except the one being rewritten and skips broken files', () => {
  const root = mkdtempSync(join(tmpdir(), 'news-feed-test-'));
  try {
    const write = (day: string, content: string) => {
      mkdirSync(join(root, day), { recursive: true });
      writeFileSync(join(root, day, 'news.json'), content);
    };
    const news = (url: string) => JSON.stringify({ entries: [{ sources: [{ name: 'Spiegel', url }] }] });
    write('2026-11-01', news('https://www.spiegel.de/a?utm_source=x'));
    write('2026-11-02', '{ not json');
    write('2026-11-03', news('https://www.spiegel.de/today'));
    assert.deepEqual(loadArchive(root, '2026-11-03'), [[{ name: 'Spiegel', key: 'spiegel.de/a' }]]);
    assert.deepEqual(loadArchive(join(root, 'missing'), '2026-11-03'), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
