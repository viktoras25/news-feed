import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeDuplicates, normalizeTitle, normalizeUrl, sourceNames } from '../src/dedupe.ts';
import type { Item } from '../src/types.ts';

function makeItem(overrides: Partial<Item>): Item {
  return {
    topic: 'national',
    source: 'Test',
    priority: 1,
    title: 'Ein ausreichend langer Titel zum Vergleichen',
    url: 'https://example.com/a',
    published: new Date('2026-10-26T06:00:00Z'),
    snippet: '',
    ...overrides,
  };
}

test('normalizeUrl removes www, utm, fragment and trailing slash', () => {
  assert.equal(
    normalizeUrl('https://www.Example.com/a/b/?utm_source=x&id=5#top'),
    'example.com/a/b?id=5',
  );
});

test('normalizeUrl treats http and https as the same address', () => {
  assert.equal(normalizeUrl('http://example.com/a'), normalizeUrl('https://example.com/a/'));
});

test('normalizeTitle ignores case, punctuation and diacritics', () => {
  assert.equal(
    normalizeTitle('Serbien: Vučić gesteht Niederlage ein!'),
    normalizeTitle('serbien vucic gesteht niederlage ein'),
  );
});

test('same URL from two feeds becomes one entry listing both sources', () => {
  const first = makeItem({ source: 'ARD', priority: 2, url: 'https://example.com/a?utm_source=x' });
  const second = makeItem({ source: 'Tagesschau', priority: 1, url: 'https://www.example.com/a' });
  const result = mergeDuplicates([first, second], new Set());
  assert.equal(result.entries.length, 1);
  assert.equal(result.removedByUrl, 1);
  // The priority 1 source is the head.
  assert.equal(result.entries[0].head.source, 'Tagesschau');
  assert.deepEqual(sourceNames(result.entries[0]), ['Tagesschau', 'ARD']);
});

test('same title under different URLs becomes one entry', () => {
  const zdf = makeItem({ source: 'ZDFheute', url: 'https://zdf.de/1', title: 'Bundestag beschließt neues Rentenpaket' });
  const spiegel = makeItem({
    source: 'Spiegel',
    url: 'https://spiegel.de/2',
    title: 'Bundestag beschließt neues Rentenpaket!',
    published: new Date('2026-10-26T07:00:00Z'),
  });
  const result = mergeDuplicates([zdf, spiegel], new Set());
  assert.equal(result.entries.length, 1);
  assert.equal(result.removedByTitle, 1);
  assert.deepEqual(sourceNames(result.entries[0]), ['ZDFheute', 'Spiegel']);
  assert.equal(result.entries[0].items.length, 2);
});

test('differently worded titles about one event are NOT merged', () => {
  const a = makeItem({ url: 'https://a.de/1', title: 'Lula gewinnt Stichwahl in Brasilien' });
  const b = makeItem({ url: 'https://b.de/1', title: 'Brasilien: Lula bleibt Präsident, Bolsonaro unterliegt' });
  assert.equal(mergeDuplicates([a, b], new Set()).entries.length, 2);
});

test('short generic titles are not merged', () => {
  const a = makeItem({ url: 'https://a.de/1', title: 'Eilmeldung' });
  const b = makeItem({ url: 'https://b.de/1', title: 'Eilmeldung' });
  assert.equal(mergeDuplicates([a, b], new Set()).entries.length, 2);
});

test('entries whose URL was exported before are marked seenBefore', () => {
  const old = makeItem({ url: 'https://www.example.com/old/?utm_source=x', title: 'Gestern schon gemeldete Nachricht' });
  const fresh = makeItem({ url: 'https://example.com/fresh', title: 'Heute neu gemeldete Nachricht' });
  const result = mergeDuplicates([old, fresh], new Set(['example.com/old']));
  const flags = result.entries.map((entry) => [entry.head.url, entry.seenBefore]);
  assert.deepEqual(flags, [
    ['https://www.example.com/old/?utm_source=x', true],
    ['https://example.com/fresh', false],
  ]);
});

test('an entry is seenBefore if any of its merged URLs was exported before', () => {
  const a = makeItem({ source: 'A', url: 'https://a.de/1', title: 'Dieselbe lange Schlagzeile hier' });
  const b = makeItem({ source: 'B', url: 'https://b.de/1', title: 'Dieselbe lange Schlagzeile hier' });
  const result = mergeDuplicates([a, b], new Set(['b.de/1']));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].seenBefore, true);
});

test('entry id is stable for the same head URL; published is the earliest time', () => {
  const item = makeItem({ url: 'https://www.example.com/a/?utm_source=x' });
  const again = makeItem({ url: 'https://example.com/a' });
  const first = mergeDuplicates([item], new Set()).entries[0];
  const second = mergeDuplicates([again], new Set()).entries[0];
  assert.equal(first.id, second.id);
  assert.equal(first.id.length, 10);

  const late = makeItem({ source: 'Late', url: 'https://x.de/1', published: new Date('2026-10-26T09:00:00Z') });
  const early = makeItem({ source: 'Early', url: 'https://x.de/1', published: new Date('2026-10-26T05:00:00Z') });
  const merged = mergeDuplicates([late, early], new Set()).entries[0];
  assert.equal(merged.published.toISOString(), '2026-10-26T05:00:00.000Z');
});
