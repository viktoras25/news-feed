import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanUrl, idFromKey, mergeDuplicates, normalizeTitle, normalizeUrl, sourceNames } from '../src/dedupe.ts';
import type { Item } from '../src/types.ts';

function makeItem(overrides: Partial<Item>): Item {
  const url = overrides.url ?? 'https://example.com/a';
  return {
    group: 'national',
    source: 'Test',
    title: 'Ein ausreichend langer Titel zum Vergleichen',
    published: new Date('2026-10-26T06:00:00Z'),
    snippet: '',
    ...overrides,
    url,
    key: normalizeUrl(url),
  };
}

test('cleanUrl removes tracking parameters and the fragment, keeps real parameters', () => {
  assert.equal(
    cleanUrl('https://WWW.Example.com/a/b?utm_source=x&id=5&wt_mc=rss&maca=feed&ref=rss&fbclid=1#ref=rss'),
    'https://www.example.com/a/b?id=5',
  );
});

test('normalizeUrl removes www, utm, fragment and trailing slash', () => {
  assert.equal(normalizeUrl('https://www.Example.com/a/b/?utm_source=x&id=5#top'), 'example.com/a/b?id=5');
});

test('normalizeUrl treats http and https as the same address', () => {
  assert.equal(normalizeUrl('http://example.com/a'), normalizeUrl('https://example.com/a/'));
});

test('a cleaned URL has the same key as the original', () => {
  const raw = 'https://www.example.com/a?utm_medium=x&id=1#ref=rss';
  assert.equal(normalizeUrl(cleanUrl(raw)), normalizeUrl(raw));
});

test('normalizeTitle ignores case, punctuation, spacing and diacritics', () => {
  assert.equal(
    normalizeTitle('Serbien:  Vučić gesteht Niederlage ein!'),
    normalizeTitle('serbien vucic gesteht niederlage ein'),
  );
});

test('same URL from two feeds becomes one entry with both sources', () => {
  const first = makeItem({ source: 'ARD', url: 'https://example.com/a?utm_source=x' });
  const second = makeItem({ source: 'Tagesschau', url: 'https://www.example.com/a' });
  const result = mergeDuplicates([first, second], new Set());
  assert.equal(result.entries.length, 1);
  assert.equal(result.removedByUrl, 1);
  assert.deepEqual(sourceNames(result.entries[0]), ['ARD', 'Tagesschau']);
  assert.equal(result.entries[0].sources.length, 2);
});

test('same title under different URLs becomes one entry; the earliest date and item win', () => {
  const late = makeItem({
    source: 'Spiegel',
    url: 'https://spiegel.de/2',
    title: 'Bundestag beschließt neues Rentenpaket!',
    published: new Date('2026-10-26T07:00:00Z'),
  });
  const early = makeItem({
    source: 'ZDFheute',
    url: 'https://zdf.de/1',
    title: 'Bundestag beschließt neues Rentenpaket',
    published: new Date('2026-10-26T05:00:00Z'),
  });
  const result = mergeDuplicates([late, early], new Set());
  assert.equal(result.entries.length, 1);
  assert.equal(result.removedByTitle, 1);
  const entry = result.entries[0];
  assert.equal(entry.published.toISOString(), '2026-10-26T05:00:00.000Z');
  assert.equal(entry.url, 'https://zdf.de/1');
  assert.equal(entry.title, 'Bundestag beschließt neues Rentenpaket');
  assert.deepEqual(entry.sources.map((s) => s.name), ['ZDFheute', 'Spiegel']);
});

test('the snippet comes from the earliest source that has one', () => {
  const a = makeItem({ source: 'A', url: 'https://a.de/1', title: 'Dieselbe lange Schlagzeile hier', snippet: '' });
  const b = makeItem({
    source: 'B',
    url: 'https://b.de/1',
    title: 'Dieselbe lange Schlagzeile hier',
    snippet: 'Text von B.',
    published: new Date('2026-10-26T07:00:00Z'),
  });
  assert.equal(mergeDuplicates([a, b], new Set()).entries[0].snippet, 'Text von B.');
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

test('an entry whose URL was exported before is seen_before, others are new', () => {
  const old = makeItem({ url: 'https://www.example.com/old/?utm_source=x', title: 'Gestern schon gemeldete Nachricht' });
  const fresh = makeItem({ url: 'https://example.com/fresh', title: 'Heute neu gemeldete Nachricht' });
  const result = mergeDuplicates([old, fresh], new Set(['example.com/old']));
  const status = Object.fromEntries(result.entries.map((entry) => [entry.url, entry.status]));
  assert.equal(status['https://www.example.com/old/?utm_source=x'], 'seen_before');
  assert.equal(status['https://example.com/fresh'], 'new');
});

test('an entry is seen_before if any of its merged URLs was exported before', () => {
  const a = makeItem({ source: 'A', url: 'https://a.de/1', title: 'Dieselbe lange Schlagzeile hier' });
  const b = makeItem({ source: 'B', url: 'https://b.de/1', title: 'Dieselbe lange Schlagzeile hier' });
  const result = mergeDuplicates([a, b], new Set(['b.de/1']));
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].status, 'seen_before');
});

test('a second run over the same items finds nothing new', () => {
  const items = [
    makeItem({ url: 'https://a.de/1', title: 'Erste ausreichend lange Meldung' }),
    makeItem({ url: 'https://b.de/2', title: 'Zweite ausreichend lange Meldung' }),
  ];
  const first = mergeDuplicates(items, new Set());
  assert.equal(first.entries.filter((e) => e.status === 'new').length, 2);
  const exported = new Set(items.map((item) => item.key));
  const second = mergeDuplicates(items, exported);
  assert.equal(second.entries.filter((e) => e.status === 'new').length, 0);
});

test('the id is the first 6 hex of the sha1 of the normalized URL and stays stable', () => {
  const item = makeItem({ url: 'https://www.example.com/a/?utm_source=x' });
  const again = makeItem({ url: 'https://example.com/a' });
  const first = mergeDuplicates([item], new Set()).entries[0];
  const second = mergeDuplicates([again], new Set()).entries[0];
  assert.equal(first.id, second.id);
  assert.match(first.id, /^[0-9a-f]{6}$/);
  assert.equal(first.id, idFromKey('example.com/a'));
});

test('ids are unique across entries', () => {
  const items: Item[] = [];
  for (let i = 0; i < 500; i++) {
    items.push(makeItem({ url: `https://example.com/story-${i}`, title: `Eigene lange Schlagzeile Nummer ${i}` }));
  }
  const ids = mergeDuplicates(items, new Set()).entries.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
});
